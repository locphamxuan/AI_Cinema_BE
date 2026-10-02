import { Injectable, Logger } from '@nestjs/common';
import { ContentReviewDecision, EpisodeStatus, MediaIngestStatus, type MediaAsset } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** Ingest states a delivery no longer leaves. */
export const DONE: MediaIngestStatus[] = [
  MediaIngestStatus.READY,
  MediaIngestStatus.FAILED,
  MediaIngestStatus.SUPERSEDED,
];

export interface ReadyResult {
  streamUrl: string;
  qualities: string[];
  durationSeconds: number;
  lastCheckedAt?: Date;
}

/**
 * MF-1 step 7 (Media Ready?): READY sends the episode to review, FAILED gives it back to the
 * Creator (BR-16). Both are written with their content event and notification in one transaction.
 */
@Injectable()
export class MediaOutcomeService {
  private readonly logger = new Logger(MediaOutcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async ready(asset: MediaAsset, result: ReadyResult): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.mediaAsset.aggregate({ where: { episodeId: asset.episodeId }, _max: { version: true } });
      if ((latest._max.version ?? 0) > asset.version) {
        // A newer delivery arrived while this one was processed: it is the one to review.
        await tx.mediaAsset.updateMany({
          where: { id: asset.id, ingestStatus: { notIn: DONE } },
          data: { ingestStatus: MediaIngestStatus.SUPERSEDED },
        });
        return;
      }
      // A stalled attempt may finish after the delivery was already failed: that outcome stands.
      const { count } = await tx.mediaAsset.updateMany({
        where: { id: asset.id, ingestStatus: { notIn: DONE } },
        data: { ...result, ingestStatus: MediaIngestStatus.READY, failureReason: null },
      });
      if (count === 0) return;
      await tx.mediaAsset.updateMany({
        where: { episodeId: asset.episodeId, version: { lt: asset.version }, ingestStatus: MediaIngestStatus.READY },
        data: { ingestStatus: MediaIngestStatus.SUPERSEDED },
      });
      const moved = await tx.episode.updateMany({
        where: { id: asset.episodeId, status: EpisodeStatus.PROCESSING },
        data: { status: EpisodeStatus.IN_REVIEW },
      });
      const episode = await tx.episode.findUniqueOrThrow({ where: { id: asset.episodeId }, include: { movie: true } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEDIA_READY,
          entityType: 'MediaAsset',
          entityId: asset.id,
          movieId: episode.movieId,
          actorId: null,
          payload: { episodeId: episode.id, version: asset.version, durationSeconds: result.durationSeconds },
        },
        tx,
      );
      // Nothing to review on a project cancelled meanwhile.
      if (!moved.count || !DELIVERY_PROJECT_STATUSES.includes(episode.movie.status)) return;
      await this.notifications.notify(
        [episode.movie.reviewerId, episode.movie.creatorId],
        {
          type: NOTIFICATION_TYPE.MEDIA_READY,
          title: `Episode ${episode.episodeNumber} of "${episode.movie.title}" is ready for review`,
          body: `Version ${asset.version}, ${formatDuration(result.durationSeconds)}.`,
          link: `/projects/${episode.movieId}/episodes/${episode.id}`,
          payload: { movieId: episode.movieId, episodeId: episode.id, mediaAssetId: asset.id },
        },
        tx,
      );
    });
  }

  /** Marks the delivery FAILED and gives the episode back to the Creator (BR-16). */
  async fail(mediaAssetId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findUnique({
        where: { id: mediaAssetId },
        include: { episode: { include: { movie: true } } },
      });
      if (!asset || DONE.includes(asset.ingestStatus)) return;
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { ingestStatus: MediaIngestStatus.FAILED, failureReason: reason.slice(0, 1000) },
      });
      // Only the latest version holds the episode in PROCESSING.
      const latest = await tx.mediaAsset.aggregate({ where: { episodeId: asset.episodeId }, _max: { version: true } });
      const moved =
        latest._max.version === asset.version
          ? await tx.episode.updateMany({
              where: { id: asset.episodeId, status: EpisodeStatus.PROCESSING },
              data: { status: await this.statusWithoutPending(tx, asset.episodeId) },
            })
          : { count: 0 };
      const { movie } = asset.episode;
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEDIA_FAILED,
          entityType: 'MediaAsset',
          entityId: asset.id,
          movieId: movie.id,
          actorId: null,
          payload: { episodeId: asset.episodeId, version: asset.version, reason },
        },
        tx,
      );
      if (!moved.count || !DELIVERY_PROJECT_STATUSES.includes(movie.status)) return;
      await this.notifications.notify(
        [movie.creatorId],
        {
          type: NOTIFICATION_TYPE.MEDIA_FAILED,
          title: `Episode ${asset.episode.episodeNumber} of "${movie.title}" could not be processed`,
          body: `${reason} Deliver the episode again or retry once the source is fixed.`,
          link: `/projects/${movie.id}/episodes/${asset.episodeId}`,
          payload: { movieId: movie.id, episodeId: asset.episodeId, mediaAssetId: asset.id },
        },
        tx,
      );
    });
    this.logger.warn(`Media ${mediaAssetId} failed: ${reason}`);
  }

  /**
   * Where an episode stands once its pending delivery is gone: back to review with the last
   * ready version, to CHANGES_REQUESTED when that version was sent back, else waiting for media.
   */
  private async statusWithoutPending(tx: PrismaTx, episodeId: string): Promise<EpisodeStatus> {
    const ready = await tx.mediaAsset.findFirst({
      where: { episodeId, ingestStatus: MediaIngestStatus.READY },
      orderBy: { version: 'desc' },
      include: { contentReviews: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!ready) return EpisodeStatus.AWAITING_MEDIA;
    return ready.contentReviews[0]?.decision === ContentReviewDecision.CHANGES_REQUESTED
      ? EpisodeStatus.CHANGES_REQUESTED
      : EpisodeStatus.IN_REVIEW;
  }
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
