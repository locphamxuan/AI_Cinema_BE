import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StudioMilestoneStatus as Milestone } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import type { UpdateMilestoneRequestDto } from '../dto/studio-handoff.request.dto';
import { assertMilestoneInput, assertMilestoneMove } from './milestone-rules';
import type { TitledProject } from 'src/modules/production/project-access/project-access.service';

/** BR-58: the Creator follows the studio's progress outside the platform and records every change. */
@Injectable()
export class MilestoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async update(projectId: string, handoffId: string, dto: UpdateMilestoneRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'lead');
    assertProjectStatus(project.status, DELIVERY_PROJECT_STATUSES, 'change the studio milestone');
    const handoff = await this.prisma.studioHandoff.findFirst({ where: { id: handoffId, projectId } });
    if (!handoff) throw new NotFoundException('Hand-off not found');

    const to = dto.status;
    const note = dto.note?.trim() || undefined;
    assertMilestoneMove(handoff.milestoneStatus, to);
    assertMilestoneInput(to, { note, mediaAssetId: dto.mediaAssetId });

    await this.prisma.$transaction(async (tx) => {
      if (dto.mediaAssetId) await this.assertSubmission(tx, dto.mediaAssetId, handoff);
      const { count } = await tx.studioHandoff.updateMany({
        where: { id: handoffId, milestoneStatus: handoff.milestoneStatus },
        data: {
          milestoneStatus: to,
          statusNote: note ?? null,
          ...(handoff.respondedAt ? {} : { respondedAt: new Date() }),
          ...(to === Milestone.STUDIO_DECLINED ? { declineReason: note } : {}),
        },
      });
      if (count === 0) throw new ConflictException('The hand-off changed meanwhile; reload it');
      await tx.studioMilestoneEvent.create({
        data: {
          handoffId,
          fromStatus: handoff.milestoneStatus,
          toStatus: to,
          note,
          mediaAssetId: dto.mediaAssetId,
          changedById: user.id,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.STUDIO_MILESTONE_UPDATED,
          entityType: 'StudioHandoff',
          entityId: handoffId,
          projectId,
          actorId: user.id,
          payload: { from: handoff.milestoneStatus, to, mediaAssetId: dto.mediaAssetId ?? null },
        },
        tx,
      );
      await this.tellReviewer(tx, project, to, note);
    });
    return this.prisma.studioHandoff.findUniqueOrThrow({
      where: { id: handoffId },
      include: { milestoneEvents: { orderBy: { createdAt: 'desc' } } },
    });
  }

  /** The Submission must be an upload for an episode this hand-off covers (the database checks it too). */
  private async assertSubmission(
    tx: PrismaTx,
    mediaAssetId: string,
    handoff: { projectId: string; seasonId: string | null },
  ) {
    const asset = await tx.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: { episode: { select: { movieId: true, seasonId: true } } },
    });
    const covered =
      asset?.episode.movieId === handoff.projectId &&
      (!handoff.seasonId || asset.episode.seasonId === handoff.seasonId);
    if (!covered) throw new BadRequestException('The Submission is not an upload for an episode of this hand-off');
  }

  private async tellReviewer(tx: PrismaTx, project: TitledProject, to: Milestone, note?: string) {
    const accepted = to === Milestone.STUDIO_ACCEPTED;
    if (!accepted && to !== Milestone.STUDIO_DECLINED) {
      await this.notifications.notify(
        [project.reviewerId],
        {
          type: NOTIFICATION_TYPE.STUDIO_MILESTONE_CHANGED,
          title: `Mốc Studio của phim "${project.movie.title}" chuyển sang ${to}`,
          body: note,
          link: `/projects/${project.id}/studio`,
          payload: { projectId: project.id, status: to },
        },
        tx,
      );
      return;
    }
    await this.notifications.notify(
      [project.reviewerId],
      {
        type: accepted ? NOTIFICATION_TYPE.STUDIO_ACCEPTED : NOTIFICATION_TYPE.STUDIO_DECLINED,
        title: accepted
          ? `Studio đã nhận phim "${project.movie.title}"`
          : `Studio từ chối phim "${project.movie.title}"${note ? `: ${note}` : ''}`,
        link: `/projects/${project.id}/studio`,
        payload: { projectId: project.id },
      },
      tx,
    );
  }
}
