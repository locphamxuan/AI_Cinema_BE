import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, MediaIngestStatus, PlaybackAccessType } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { runningPlanWhere } from 'src/modules/episode-access/subscription/running-plan';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';

export interface VerifiedPlayback {
  episodeId: string;
  movieId: string;
  mediaAssetId: string;
  streamUrl: string;
  qualities: string[];
  durationSeconds: number | null;
  accessType: PlaybackAccessType;
  planCode: string | null;
  subtitles: { language: string; fileUrl: string; isDefault: boolean }[];
  aiLabel: { type: string; text: string; displayLocation: string | null } | null;
}

/**
 * Main Flow 3, steps 2-4: re-verifies that the caller may still play the episode
 * before a streaming session is created. The check order mirrors the access
 * decision of Main Flow 2 — Free Starter, zero price, running plan, bought
 * episode — and never trusts what the client claims from `GET /access`.
 */
@Injectable()
export class PlaybackAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  async verify(episodeId: string, userId?: string): Promise<VerifiedPlayback> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: EpisodeStatus.PUBLISHED },
      include: {
        approvedMediaAsset: {
          include: {
            subtitles: { select: { language: true, fileUrl: true, isDefault: true } },
            aiContentLabel: { select: { labelType: true, labelText: true, displayLocation: true } },
          },
        },
      },
    });
    if (!episode) {
      throw new NotFoundException({
        message: 'Episode not found',
        details: { reason: 'EPISODE_NOT_FOUND' },
      });
    }
    if (episode.revisionStartedAt !== null) {
      throw new ConflictException({
        message: 'The episode is under maintenance and cannot be played',
        details: { reason: 'EPISODE_UNDER_REVISION' },
      });
    }
    const media = episode.approvedMediaAsset;
    if (!media || media.ingestStatus !== MediaIngestStatus.READY || !media.streamUrl) {
      throw new ConflictException({
        message: 'The episode has no playable stream yet',
        details: { reason: 'MEDIA_NOT_READY' },
      });
    }
    const base = {
      episodeId: episode.id,
      movieId: episode.movieId,
      mediaAssetId: media.id,
      streamUrl: media.streamUrl,
      qualities: media.qualities,
      durationSeconds: media.durationSeconds,
      subtitles: media.subtitles.map((subtitle) => ({
        language: subtitle.language,
        fileUrl: subtitle.fileUrl,
        isDefault: subtitle.isDefault,
      })),
      aiLabel: media.aiContentLabel
        ? {
            type: media.aiContentLabel.labelType,
            text: media.aiContentLabel.labelText,
            displayLocation: media.aiContentLabel.displayLocation,
          }
        : null,
    };

    const settings = await this.settings.get();
    // A published episode always carries a price; rows predating the column fall back to the floor.
    const coinPrice = episode.coinPrice ?? settings.episodeCoinPriceMin;
    // Free rules need no account. A zero-priced episode is stored as FREE_STARTER:
    // PlaybackAccessType has no FREE value and both cases mean "free for everyone".
    if (episode.episodeNumber <= settings.freeStarterEpisodeCount || coinPrice === 0) {
      return { ...base, accessType: PlaybackAccessType.FREE_STARTER, planCode: null };
    }
    if (!userId) {
      throw new ForbiddenException({
        message: 'This episode requires a sign-in, a plan or an episode unlock',
        details: { reason: 'PLAYBACK_ACCESS_REQUIRED' },
      });
    }

    const [plan, episodeAccess] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: runningPlanWhere(userId),
        orderBy: { currentPeriodEnd: 'desc' },
        include: { plan: { select: { code: true } } },
      }),
      this.prisma.episodeAccess.findFirst({ where: { userId, episodeId, revokedAt: null } }),
    ]);
    if (plan) return { ...base, accessType: PlaybackAccessType.PLAN, planCode: plan.plan.code };
    if (episodeAccess) {
      return {
        ...base,
        accessType:
          episodeAccess.source === 'ADMIN_GRANT' ? PlaybackAccessType.ADMIN_GRANT : PlaybackAccessType.EPISODE_PURCHASE,
        planCode: null,
      };
    }
    throw new ForbiddenException({
      message: 'This episode requires a plan or an episode unlock',
      details: { reason: 'PLAYBACK_ACCESS_REQUIRED' },
    });
  }
}
