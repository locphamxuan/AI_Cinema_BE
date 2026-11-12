import { ConflictException, Injectable } from '@nestjs/common';
import { EpisodeStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertEpisodeStatus } from 'src/modules/production/project-access/project-rules';

/**
 * MF-1 §5–6 (07/11/2026): once the studio's film passed review, the AI label and the four compliance checks, the
 * Reviewer confirms it as the Final Film and the Admin is told. The Admin publishes it, or sends it back to the
 * Reviewer with a reason — never to the studio: the Reviewer then asks the studio for the changes (content
 * review), which clears the confirmation until the new version is confirmed again.
 */
@Injectable()
export class FinalFilmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async confirm(episodeId: string, reviewer: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, reviewer, 'reviewer');
    assertEpisodeStatus(episode.status, [EpisodeStatus.COMPLIANCE_PASSED], 'confirm the Final Film');
    // 2026-11-11: the Admin prices the episode after this step, so no price is asked for here; the release gate
    // (PublicationService.missingForRelease and the publish_compliance_gate trigger) still refuses an unpriced episode.
    if (episode.finalConfirmedAt) throw new ConflictException('The Final Film is already confirmed');
    return this.prisma.$transaction(async (tx) => {
      await this.move(tx, episodeId, false, {
        finalConfirmedAt: new Date(),
        finalConfirmedById: reviewer.id,
        finalRejectionNote: null,
      });
      await this.record(tx, episode, CONTENT_EVENT.FINAL_FILM_CONFIRMED, reviewer.id, {});
      await this.notifications.notify(
        await this.notifications.adminIds(tx),
        {
          type: NOTIFICATION_TYPE.FINAL_FILM_CONFIRMED,
          title: `Phim Final tập ${episode.episodeNumber} của "${episode.movie.title}" chờ Admin duyệt`,
          body: 'Reviewer đã kiểm tra nội dung, pháp lý và xác nhận Phim Final; Admin xem và quyết định Publish.',
          link: `/projects/${episode.movieId}/episodes/${episode.id}`,
          payload: { projectId: episode.movieId, episodeId },
        },
        tx,
      );
      return tx.episode.findUniqueOrThrow({ where: { id: episodeId } });
    });
  }

  async reject(episodeId: string, reason: string, admin: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, admin, 'read');
    assertEpisodeStatus(episode.status, [EpisodeStatus.COMPLIANCE_PASSED], 'send the Final Film back');
    if (!episode.finalConfirmedAt) throw new ConflictException('The Reviewer has not confirmed this Final Film');
    const note = reason.trim();
    return this.prisma.$transaction(async (tx) => {
      await this.move(tx, episodeId, true, {
        finalConfirmedAt: null,
        finalConfirmedById: null,
        finalRejectionNote: note,
      });
      await this.record(tx, episode, CONTENT_EVENT.FINAL_FILM_REJECTED, admin.id, { reason: note });
      await this.notifications.notify(
        [episode.project.reviewerId],
        {
          type: NOTIFICATION_TYPE.FINAL_FILM_REJECTED,
          title: `Admin yêu cầu sửa Phim Final tập ${episode.episodeNumber} của "${episode.movie.title}"`,
          body: `Trao đổi với Studio để sửa phim: ${note}`,
          link: `/projects/${episode.movieId}/episodes/${episode.id}`,
          payload: { projectId: episode.movieId, episodeId },
        },
        tx,
      );
      return tx.episode.findUniqueOrThrow({ where: { id: episodeId } });
    });
  }

  /** Writes the confirmation only if nobody changed it meanwhile (double click, concurrent review). */
  private async move(
    tx: PrismaTx,
    episodeId: string,
    confirmed: boolean,
    data: { finalConfirmedAt: Date | null; finalConfirmedById: string | null; finalRejectionNote: string | null },
  ): Promise<void> {
    const { count } = await tx.episode.updateMany({
      where: {
        id: episodeId,
        status: EpisodeStatus.COMPLIANCE_PASSED,
        finalConfirmedAt: confirmed ? { not: null } : null,
      },
      data,
    });
    if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
  }

  private record(
    tx: PrismaTx,
    episode: { id: string; movieId: string },
    action: (typeof CONTENT_EVENT)['FINAL_FILM_CONFIRMED' | 'FINAL_FILM_REJECTED'],
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      { action, entityType: 'Episode', entityId: episode.id, projectId: episode.movieId, actorId, payload },
      tx,
    );
  }
}
