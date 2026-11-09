import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, UnpublishReason, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import {
  assertProjectStatus,
  DELIVERY_PROJECT_STATUSES,
  OPEN_PROJECT_STATUSES,
} from 'src/modules/production/project-access/project-rules';
import { ProjectTeamService } from './team/project-team.service';

const projectLink = (projectId: string) => `/projects/${projectId}`;

/** Status changes of a movie project (§4.1.2). */
@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly team: ProjectTeamService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Throws unless the account is active and holds the role, e.g. the Reviewer or Creator the Admin picks. */
  async assertActive(userId: string, role: UserRole): Promise<void> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true },
    });
    if (account?.role !== role || !account.isActive) {
      throw new BadRequestException(`Pick an active ${role} account`);
    }
  }

  /** Tells the Reviewer the Admin put them in charge of a new project. */
  async announceReviewer(projectId: string): Promise<void> {
    const project = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      include: { movie: true },
    });
    await this.notifications.notify([project.reviewerId], {
      type: NOTIFICATION_TYPE.PROJECT_ASSIGNED,
      title: `Bạn phụ trách duyệt dự án phim "${project.movie.title}"`,
      body: 'Admin vừa tạo dự án; lên cấu trúc mùa/tập và duyệt kịch bản Creator nộp.',
      link: projectLink(projectId),
      payload: { projectId },
    });
  }

  /**
   * MF-1 step 1 (07/11/2026): the Admin assigns (or reassigns) the lead Creator, who then aligns the idea with the
   * Admin and writes the script; budget and episodes come later, before the studio is contracted.
   */
  async assignCreator(projectId: string, creatorId: string, user: AuthenticatedUser): Promise<void> {
    const project = await this.access.project(projectId, user, 'read');
    assertProjectStatus(project.status, OPEN_PROJECT_STATUSES, 'assign a Content Creator');
    await this.assertActive(creatorId, UserRole.CONTENT_CREATOR);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.movieProject.updateMany({
        where: { id: projectId, status: { in: OPEN_PROJECT_STATUSES } },
        data: {
          creatorId,
          status: project.status === ProjectStatus.DRAFT ? ProjectStatus.ASSIGNED : project.status,
        },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      // The lead takes a seat; the previous lead's seat ends and their episodes go back to the team.
      if (project.creatorId && project.creatorId !== creatorId)
        await this.team.release(tx, projectId, project.creatorId);
      await this.team.seat(tx, project, creatorId, { assignedById: user.id });
      await this.notifications.notify(
        [creatorId],
        {
          type: NOTIFICATION_TYPE.PROJECT_ASSIGNED,
          title: `Bạn được giao dự án phim "${project.movie.title}"`,
          link: projectLink(projectId),
          payload: { projectId },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_ASSIGNED,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: user.id,
          payload: { creatorId, previousCreatorId: project.creatorId },
        },
        tx,
      );
    });
  }

  /**
   * BR-39: cancel while no episode was ever published; the fees committed to studios stay a cost. Releases
   * still scheduled are withdrawn with it, so the scheduler never puts them out.
   */
  async cancel(projectId: string, reason: string, user: AuthenticatedUser): Promise<void> {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(project.status, OPEN_PROJECT_STATUSES, 'cancel the project');
    const published = await this.prisma.publication.count({
      where: { episode: { movieId: projectId }, publishedAt: { not: null } },
    });
    if (published) throw new ConflictException('An episode of this project was already published (BR-39)');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.movieProject.updateMany({
        where: { id: projectId, status: { in: OPEN_PROJECT_STATUSES } },
        data: { status: ProjectStatus.CANCELLED, cancelReason: reason.trim(), cancelledAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      const withdrawn = await this.withdrawScheduledReleases(tx, projectId, reason, user.id);
      await this.notifications.notify(
        [project.creatorId],
        {
          type: NOTIFICATION_TYPE.PROJECT_CANCELLED,
          title: `Dự án phim "${project.movie.title}" đã bị huỷ`,
          body: reason,
          link: projectLink(projectId),
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_CANCELLED,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: user.id,
          payload: { reason, withdrawnReleases: withdrawn },
        },
        tx,
      );
    });
  }

  /** Withdraws the scheduled releases of a cancelled project; returns how many there were. */
  private async withdrawScheduledReleases(tx: PrismaTx, projectId: string, reason: string, actorId: string) {
    const { count } = await tx.publication.updateMany({
      where: { episode: { movieId: projectId }, publishedAt: null, unpublishedAt: null },
      data: {
        unpublishedAt: new Date(),
        unpublishReason: UnpublishReason.MANUAL,
        unpublishNote: `Project cancelled: ${reason.trim()}`,
        unpublishedById: actorId,
      },
    });
    await tx.episode.updateMany({
      where: { movieId: projectId, status: EpisodeStatus.SCHEDULED },
      data: { status: EpisodeStatus.COMPLIANCE_PASSED },
    });
    return count;
  }

  /**
   * Step 16: the project is COMPLETED once every episode is out (BR-38), and again once the
   * episodes taken down to be fixed are back (BR-56). An episode taken down for good does not
   * hold the project open.
   */
  async completeIfAllPublished(projectId: string, tx: PrismaTx): Promise<boolean> {
    const pending = await tx.episode.count({
      where: { movieId: projectId, status: { notIn: [EpisodeStatus.PUBLISHED, EpisodeStatus.UNPUBLISHED] } },
    });
    if (pending) return false;
    const { count } = await tx.movieProject.updateMany({
      where: { id: projectId, status: { in: DELIVERY_PROJECT_STATUSES } },
      data: { status: ProjectStatus.COMPLETED, completedAt: new Date() },
    });
    if (count) {
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_COMPLETED,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: null,
        },
        tx,
      );
    }
    return count > 0;
  }
}
