import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EpisodeStatus, MovieStatus, UnpublishReason, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import {
  assertProjectStatus,
  DELIVERY_PROJECT_STATUSES,
  OPEN_PROJECT_STATUSES,
} from 'src/modules/production/project-access/project-rules';

const projectLink = (movieId: string) => `/projects/${movieId}`;

/** Status changes of a movie project (§4.1.2). */
@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly fees: ProductionFeeService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Step 2: assign the Creator once the project is complete and funded (BR-12); also reassigns later. */
  async assignCreator(movieId: string, creatorId: string, user: AuthenticatedUser): Promise<void> {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'assign a Content Creator');
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true, isActive: true },
    });
    if (creator?.role !== UserRole.CONTENT_CREATOR || !creator.isActive) {
      throw new BadRequestException('Pick an active Content Creator account');
    }
    if ((await this.fees.totalTokens(movieId)) <= 0) {
      throw new ConflictException('Allocate the production fee before assigning a Creator (BR-12)');
    }
    if (!(await this.prisma.episode.count({ where: { movieId } }))) {
      throw new ConflictException('The project needs at least one episode');
    }
    if (await this.prisma.episode.count({ where: { movieId, milestoneDate: null } })) {
      throw new ConflictException('Set a milestone for every episode before assigning a Creator');
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.movie.updateMany({
        where: { id: movieId, status: { in: OPEN_PROJECT_STATUSES } },
        data: {
          creatorId,
          status: movie.status === MovieStatus.DRAFT ? MovieStatus.ASSIGNED : movie.status,
          assignedAt: new Date(),
        },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      await this.notifications.notify(
        [creatorId],
        {
          type: NOTIFICATION_TYPE.PROJECT_ASSIGNED,
          title: `Bạn được giao dự án phim "${movie.title}"`,
          link: projectLink(movieId),
          payload: { movieId },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_ASSIGNED,
          entityType: 'Movie',
          entityId: movieId,
          movieId,
          actorId: user.id,
          payload: { creatorId, previousCreatorId: movie.creatorId },
        },
        tx,
      );
    });
  }

  /**
   * BR-39: cancel while no episode was ever published; the Token spent stays a cost. Releases
   * still scheduled are withdrawn with it, so the scheduler never puts them out.
   */
  async cancel(movieId: string, reason: string, user: AuthenticatedUser): Promise<void> {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'cancel the project');
    const published = await this.prisma.publication.count({
      where: { episode: { movieId }, publishedAt: { not: null } },
    });
    if (published) throw new ConflictException('An episode of this project was already published (BR-39)');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.movie.updateMany({
        where: { id: movieId, status: { in: OPEN_PROJECT_STATUSES } },
        data: { status: MovieStatus.CANCELLED, cancelReason: reason.trim(), cancelledAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      const withdrawn = await this.withdrawScheduledReleases(tx, movieId, reason, user.id);
      await this.notifications.notify(
        [movie.creatorId],
        {
          type: NOTIFICATION_TYPE.PROJECT_CANCELLED,
          title: `Dự án phim "${movie.title}" đã bị huỷ`,
          body: reason,
          link: projectLink(movieId),
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_CANCELLED,
          entityType: 'Movie',
          entityId: movieId,
          movieId,
          actorId: user.id,
          payload: { reason, withdrawnReleases: withdrawn },
        },
        tx,
      );
    });
  }

  /** Withdraws the scheduled releases of a cancelled project; returns how many there were. */
  private async withdrawScheduledReleases(tx: PrismaTx, movieId: string, reason: string, actorId: string) {
    const { count } = await tx.publication.updateMany({
      where: { episode: { movieId }, publishedAt: null, unpublishedAt: null },
      data: {
        unpublishedAt: new Date(),
        unpublishReason: UnpublishReason.MANUAL,
        unpublishNote: `Project cancelled: ${reason.trim()}`,
        unpublishedById: actorId,
      },
    });
    await tx.episode.updateMany({
      where: { movieId, status: EpisodeStatus.SCHEDULED },
      data: { status: EpisodeStatus.COMPLIANCE_PASSED },
    });
    return count;
  }

  /**
   * Step 16: the project is COMPLETED once every episode is out (BR-38), and again once the
   * episodes taken down to be fixed are back (BR-56). An episode taken down for good does not
   * hold the project open.
   */
  async completeIfAllPublished(movieId: string, tx: PrismaTx): Promise<boolean> {
    const pending = await tx.episode.count({
      where: { movieId, status: { notIn: [EpisodeStatus.PUBLISHED, EpisodeStatus.UNPUBLISHED] } },
    });
    if (pending) return false;
    const { count } = await tx.movie.updateMany({
      where: { id: movieId, status: { in: DELIVERY_PROJECT_STATUSES } },
      data: { status: MovieStatus.COMPLETED, completedAt: new Date() },
    });
    if (count) {
      await this.auditLog.record(
        { action: CONTENT_EVENT.PROJECT_COMPLETED, entityType: 'Movie', entityId: movieId, movieId, actorId: null },
        tx,
      );
    }
    return count > 0;
  }
}
