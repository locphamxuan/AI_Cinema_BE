import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SUPPORT_TOOL, type SupportToolName } from './tool-definitions';

export type SupportToolResult = { ok: true; data: unknown } | { ok: false; error: 'NOT_FOUND' | 'UNAVAILABLE' };

/**
 * Read-only lookups for the AI (plan §5.2). `memberId` is supplied by the chat layer from the
 * signed-in user, never by the model. Errors become `{ ok: false }` so the model can answer
 * gracefully instead of the whole turn failing.
 */
@Injectable()
export class SupportTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  async execute(
    name: SupportToolName,
    memberId: string,
    args: Record<string, unknown> = {},
  ): Promise<SupportToolResult> {
    try {
      switch (name) {
        case SUPPORT_TOOL.GET_MEMBER_WALLET:
          return await this.wallet(memberId);
        case SUPPORT_TOOL.GET_MEMBER_SUBSCRIPTION:
          return await this.subscription(memberId);
        case SUPPORT_TOOL.GET_RECENT_TOPUPS:
          return await this.recentTopUps(memberId);
        case SUPPORT_TOOL.GET_RECENT_PAYMENTS:
          return await this.recentPayments(memberId);
        case SUPPORT_TOOL.GET_RECENT_COIN_TRANSACTIONS:
          return await this.recentCoinTransactions(memberId);
        case SUPPORT_TOOL.GET_PLAN_CATALOG:
          return await this.planCatalog();
        case SUPPORT_TOOL.SEARCH_CATALOG:
          return await this.searchCatalog(typeof args.query === 'string' ? args.query : '');
        case SUPPORT_TOOL.GET_EPISODE_ACCESS:
          return await this.episodeAccess(memberId, typeof args.episodeId === 'string' ? args.episodeId : undefined);
        case SUPPORT_TOOL.GET_MEMBER_DEVICES:
          return await this.devices(memberId);
        case SUPPORT_TOOL.GET_RECENT_STREAMING_SESSIONS:
          return await this.streamingSessions(memberId);
        case SUPPORT_TOOL.GET_PLATFORM_POLICY_SNAPSHOT:
          return await this.policySnapshot();
        default:
          return { ok: false, error: 'UNAVAILABLE' };
      }
    } catch {
      // Never leak a driver message to the model; it just sees "no data".
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  private async wallet(memberId: string): Promise<SupportToolResult> {
    const wallet = await this.prisma.coinWallet.findUnique({
      where: { userId: memberId },
      select: {
        mainBalance: true,
        bonusBalance: true,
        lots: {
          where: { remainingAmount: { gt: 0 }, expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'asc' },
          take: 3,
          select: { remainingAmount: true, expiresAt: true },
        },
      },
    });
    if (!wallet) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, data: wallet };
  }

  private async subscription(memberId: string): Promise<SupportToolResult> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: memberId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        autoRenew: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        nextRenewalAt: true,
        cancelWindowEndsAt: true,
        priceCoins: true,
        plan: { select: { code: true, name: true, period: true, features: true } },
      },
    });
    return subscription ? { ok: true, data: subscription } : { ok: false, error: 'NOT_FOUND' };
  }

  private async recentTopUps(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.coinTopUp.findMany({
      where: { userId: memberId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        amountVnd: true,
        coinsGranted: true,
        status: true,
        failureReason: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { ok: true, data: rows };
  }

  private async recentPayments(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.payment.findMany({
      where: { userId: memberId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        provider: true,
        amountVnd: true,
        status: true,
        failureReason: true,
        paidAt: true,
        createdAt: true,
      },
    });
    return { ok: true, data: rows };
  }

  private async recentCoinTransactions(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.coinTransaction.findMany({
      where: { wallet: { userId: memberId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        entryType: true,
        mainAmount: true,
        bonusAmount: true,
        description: true,
        mainBalanceAfter: true,
        bonusBalanceAfter: true,
        createdAt: true,
      },
    });
    return { ok: true, data: rows };
  }

  private async planCatalog(): Promise<SupportToolResult> {
    const plans = await this.prisma.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        name: true,
        description: true,
        period: true,
        durationDays: true,
        isFree: true,
        features: true,
        prices: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { priceCoins: true },
        },
      },
    });
    return { ok: true, data: plans };
  }

  private async searchCatalog(query: string): Promise<SupportToolResult> {
    if (!query.trim()) return { ok: false, error: 'NOT_FOUND' };
    const movies = await this.prisma.movie.findMany({
      where: {
        title: { contains: query.trim(), mode: 'insensitive' },
        episodes: { some: { status: 'PUBLISHED' } },
      },
      take: 5,
      select: {
        id: true,
        title: true,
        synopsis: true,
        releaseYear: true,
        episodes: {
          where: { status: 'PUBLISHED' },
          orderBy: { episodeNumber: 'asc' },
          take: 5,
          select: { id: true, episodeNumber: true, title: true, coinPrice: true },
        },
      },
    });
    return movies.length ? { ok: true, data: movies } : { ok: false, error: 'NOT_FOUND' };
  }

  private async episodeAccess(memberId: string, episodeId?: string): Promise<SupportToolResult> {
    const rows = await this.prisma.episodeAccess.findMany({
      where: { userId: memberId, ...(episodeId ? { episodeId } : {}) },
      orderBy: { grantedAt: 'desc' },
      take: 10,
      select: {
        episodeId: true,
        source: true,
        paidCoins: true,
        grantedAt: true,
        revokedAt: true,
        revokeReason: true,
        episode: { select: { episodeNumber: true, title: true, movie: { select: { title: true } } } },
      },
    });
    return { ok: true, data: rows };
  }

  private async devices(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.userDevice.findMany({
      where: { userId: memberId },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: { name: true, platform: true, createdAt: true, lastSeenAt: true },
    });
    return { ok: true, data: rows };
  }

  private async streamingSessions(memberId: string): Promise<SupportToolResult> {
    const rows = await this.prisma.streamingSession.findMany({
      where: { userId: memberId },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        status: true,
        accessType: true,
        startedAt: true,
        endedAt: true,
        endReason: true,
        episode: { select: { episodeNumber: true, title: true, movie: { select: { title: true } } } },
      },
    });
    return { ok: true, data: rows };
  }

  private async policySnapshot(): Promise<SupportToolResult> {
    const setting = await this.settings.get();
    // Only the member-facing policies; the updater identity stays internal.
    return {
      ok: true,
      data: {
        coinRateVnd: setting.coinRateVnd,
        bonusCoinExpiryDays: setting.bonusCoinExpiryDays,
        coinTopUpMinVnd: setting.coinTopUpMinVnd,
        coinTopUpMaxVnd: setting.coinTopUpMaxVnd,
        subscriptionCancelWindowHours: setting.subscriptionCancelWindowHours,
        freeStarterEpisodeCount: setting.freeStarterEpisodeCount,
        refundOnRemoval: setting.refundOnRemoval,
      },
    };
  }
}
