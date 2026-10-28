import { HttpException } from '@nestjs/common';
import { EpisodeStatus, Prisma, type Publication, UnpublishReason } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';

/**
 * A failure the same release would hit again: an HTTP refusal from a rule, or the database
 * rejecting the write (trigger, constraint). Connection errors (P1xxx) and the like are not.
 */
export function isRefusal(error: unknown): boolean {
  if (error instanceof HttpException) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return !error.code.startsWith('P1');
  return error instanceof Prisma.PrismaClientUnknownRequestError;
}

/**
 * Puts a scheduled release that cannot go out back in the Reviewer's hands: the schedule is
 * withdrawn, the episode returns to COMPLIANCE_PASSED and the Reviewer is told why.
 */
export async function withdrawFailedRelease(
  tx: PrismaTx,
  publication: Publication,
  cause: string,
  deps: { auditLog: AuditLogService; notifications: NotificationService },
): Promise<void> {
  const { count } = await tx.publication.updateMany({
    where: { id: publication.id, publishedAt: null, unpublishedAt: null },
    data: {
      unpublishedAt: new Date(),
      unpublishReason: UnpublishReason.MANUAL,
      unpublishNote: `Scheduled release failed: ${cause}`.slice(0, 1000),
    },
  });
  // Released or withdrawn meanwhile: nothing left to hand back.
  if (count === 0) return;
  await tx.episode.updateMany({
    where: { id: publication.episodeId, status: EpisodeStatus.SCHEDULED },
    data: { status: EpisodeStatus.COMPLIANCE_PASSED },
  });
  const episode = await tx.episode.findUniqueOrThrow({
    where: { id: publication.episodeId },
    include: { movie: true },
  });
  await deps.auditLog.record(
    {
      action: CONTENT_EVENT.EPISODE_UNPUBLISHED,
      entityType: 'Publication',
      entityId: publication.id,
      movieId: episode.movieId,
      actorId: null,
      payload: { episodeId: episode.id, mode: null, cancelledSchedule: true, failure: cause },
    },
    tx,
  );
  await deps.notifications.notify(
    [episode.movie.reviewerId],
    {
      type: NOTIFICATION_TYPE.EPISODE_RELEASE_FAILED,
      title: `Tập ${episode.episodeNumber} của phim "${episode.movie.title}" chưa phát hành được`,
      body: `Lịch phát hành đã bị huỷ: ${cause}. Kiểm tra lại rồi đặt lịch mới.`,
      link: `/projects/${episode.movieId}/episodes/${episode.id}`,
      payload: { movieId: episode.movieId, episodeId: episode.id, publicationId: publication.id },
    },
    tx,
  );
}
