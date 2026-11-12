import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CatalogService } from 'src/modules/catalog/catalog.service';
import { DailyRewardService } from 'src/modules/episode-access/daily-reward/daily-reward.service';
import { RecommendationService } from 'src/modules/playback/recommendation/recommendation.service';
import type { SupportToolResult } from './support-tools.service';

const LIST_SIZE = 10;

/**
 * Read-only lookups about what the member watches and what is on the platform (audit 2026-11-12): the
 * questions a member asks besides money — most viewed movies, what to watch next, where they stopped,
 * today's check-in, what they unlocked, what comes out soon. `memberId` always comes from the session.
 */
@Injectable()
export class ActivityTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly recommendations: RecommendationService,
    private readonly dailyRewards: DailyRewardService,
  ) {}

  /** "Phim nào đang nhiều lượt xem?" — the same ranking the app shows. */
  async trendingMovies(): Promise<SupportToolResult> {
    const rows = await this.catalog.ranking(LIST_SIZE);
    return { ok: true, data: rows.map((m) => ({ id: m.id, title: m.title, viewCount: m.viewCount })) };
  }

  /** "Tôi nên xem phim gì?" — the member's own behavior-based list, with the reason of each pick. */
  async myRecommendations(memberId: string): Promise<SupportToolResult> {
    const rows = await this.recommendations.forYou(memberId);
    return { ok: true, data: rows.slice(0, 5).map((r) => ({ movieId: r.movieId, title: r.title, reason: r.reason })) };
  }

  /** "Tôi đang xem dở phim nào / tập nào?" */
  async watchHistory(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.watchProgress.findMany({
      where: { userId: memberId },
      orderBy: { lastWatchedAt: 'desc' },
      take: LIST_SIZE,
      select: {
        positionSeconds: true,
        durationSeconds: true,
        completed: true,
        lastWatchedAt: true,
        episode: { select: { episodeNumber: true, movie: { select: { title: true } } } },
      },
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        movie: r.episode.movie.title,
        episodeNumber: r.episode.episodeNumber,
        watchedSeconds: r.positionSeconds,
        durationSeconds: r.durationSeconds,
        completed: r.completed,
        lastWatchedAt: r.lastWatchedAt,
      })),
    };
  }

  /** "Hôm nay tôi điểm danh chưa / còn lượt quay không?" */
  async rewardStatus(memberId: string): Promise<SupportToolResult> {
    return { ok: true, data: await this.dailyRewards.status(memberId) };
  }

  /** "Tôi đã mở khóa những tập nào?" */
  async unlockedEpisodes(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.episodeAccess.findMany({
      where: { userId: memberId },
      orderBy: { grantedAt: 'desc' },
      take: LIST_SIZE,
      select: {
        source: true,
        paidCoins: true,
        grantedAt: true,
        revokedAt: true,
        revokeReason: true,
        episode: { select: { episodeNumber: true, movie: { select: { title: true } } } },
      },
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        movie: r.episode.movie.title,
        episodeNumber: r.episode.episodeNumber,
        source: r.source,
        paidCoins: r.paidCoins,
        unlockedAt: r.grantedAt,
        revokedAt: r.revokedAt,
        revokeReason: r.revokeReason,
      })),
    };
  }

  /** "Bao giờ có tập mới?" — releases scheduled and not out yet. */
  async upcomingReleases(): Promise<SupportToolResult> {
    const rows = await this.prisma.publication.findMany({
      where: { publishedAt: null, unpublishedAt: null, scheduledAt: { gt: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: LIST_SIZE,
      select: { scheduledAt: true, episode: { select: { episodeNumber: true, movie: { select: { title: true } } } } },
    });
    return {
      ok: true,
      data: rows.map((r) => ({
        movie: r.episode.movie.title,
        episodeNumber: r.episode.episodeNumber,
        releaseAt: r.scheduledAt,
      })),
    };
  }
}
