import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MediaIngestStatus, MediaSourceMethod } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { probeHls } from './hls-playlist';

export interface HlsCheckResult {
  checked: number;
  dead: number;
}

/**
 * BR-17: external HLS links of approved episodes (scheduled or published) are checked again
 * on a schedule. `last_checked_at` is the last time the link worked; a dead link is reported
 * once to the Creator and the Reviewer until it works again.
 */
@Injectable()
export class HlsLinkCheckJob implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('media.hls-check', this.config.schedules.hlsCheckMs, () =>
      this.sweep().then(() => undefined),
    );
  }

  async sweep(): Promise<HlsCheckResult> {
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        sourceMethod: MediaSourceMethod.HLS_URL,
        ingestStatus: MediaIngestStatus.READY,
        approvedInEpisode: { isNot: null },
      },
      include: {
        episode: { include: { movie: { select: { id: true, title: true, reviewerId: true, creatorId: true } } } },
      },
    });

    let dead = 0;
    for (const asset of assets) {
      try {
        await probeHls(asset.sourceUrl!, { allowPrivate: this.config.media.allowPrivateUrls });
        await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { lastCheckedAt: new Date() } });
      } catch (error) {
        dead += 1;
        const reported = await this.prisma.notification.count({
          where: {
            type: NOTIFICATION_TYPE.HLS_LINK_DEAD,
            payload: { path: ['mediaAssetId'], equals: asset.id },
            createdAt: { gt: asset.lastCheckedAt ?? asset.createdAt },
          },
        });
        if (reported) continue;
        const { movie } = asset.episode;
        await this.notifications.notify([movie.creatorId, movie.reviewerId], {
          type: NOTIFICATION_TYPE.HLS_LINK_DEAD,
          title: `The video link of episode ${asset.episode.episodeNumber} of "${movie.title}" stopped working`,
          body: `${(error as Error).message}. Ask the studio to fix the link or deliver the episode again.`,
          link: `/projects/${movie.id}/episodes/${asset.episodeId}`,
          payload: { movieId: movie.id, episodeId: asset.episodeId, mediaAssetId: asset.id },
        });
      }
    }
    return { checked: assets.length, dead };
  }
}
