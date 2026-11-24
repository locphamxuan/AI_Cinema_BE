import { ComplianceResult, EpisodeStatus, type Episode, type Movie, type MovieProject } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';

const COMPLIANCE_ITEMS = 4;

/** What still blocks the release of an episode (BR-19, step 12); empty when it can go out. */
export async function missingForRelease(
  db: PrismaService | PrismaTx,
  episode: Episode & { movie: Movie },
): Promise<string[]> {
  const missing: string[] = [];
  const mediaAssetId = episode.approvedMediaAssetId;
  if (!mediaAssetId) missing.push('an approved media version');
  if (episode.status === EpisodeStatus.COMPLIANCE_PASSED && !episode.finalConfirmedAt) {
    missing.push('the Final Film confirmation of the Reviewer');
  }
  if (episode.coinPrice === null) missing.push('a Coin price (BR-29)');
  if (!episode.movie.synopsis?.trim()) missing.push('the movie synopsis');
  if (!episode.movie.ageRating) missing.push('the movie age rating');
  if (mediaAssetId) {
    const [label, passed] = await Promise.all([
      db.aiContentLabel.count({ where: { mediaAssetId } }),
      db.complianceCheck.count({ where: { mediaAssetId, result: ComplianceResult.PASS } }),
    ]);
    if (!label) missing.push('an AI label (BR-40)');
    if (passed < COMPLIANCE_ITEMS) missing.push('a passed compliance check (BR-42)');
  }
  return missing;
}

/**
 * BR-52/BR-56: when the Admin takes a published episode down, the Reviewer in charge and the lead Creator learn it
 * with the reason (the Admins follow along through the MF-1 fan-out); the studio is told by the revision itself.
 */
export function announceTakedown(
  tx: PrismaTx,
  notifications: NotificationService,
  episode: Episode & { movie: Movie; project: MovieProject },
  takedown: { mode: string | null; note: string; publicationId: string },
): Promise<void> {
  const fixed = takedown.mode === 'REVISION';
  return notifications.notify(
    [episode.project.reviewerId, episode.project.creatorId],
    {
      type: NOTIFICATION_TYPE.EPISODE_UNPUBLISHED,
      title: `Tập ${episode.episodeNumber} của phim "${episode.movie.title}" đã bị gỡ ${fixed ? 'để sửa' : 'hẳn'}`,
      body: takedown.note,
      link: `/projects/${episode.movieId}/episodes/${episode.id}`,
      payload: {
        projectId: episode.movieId,
        episodeId: episode.id,
        publicationId: takedown.publicationId,
        mode: takedown.mode,
      },
    },
    tx,
  );
}
