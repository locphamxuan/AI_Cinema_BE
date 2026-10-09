import { ConflictException, Injectable } from '@nestjs/common';
import { AccessSource, CoinEntryType, CoinReferenceType, EpisodeStatus, SubscriptionStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';
import type { PurchaseResultDto } from './dto/purchase-result.dto';

/** A plan that already grants the episode makes buying it pointless. */
const RUNNING_PLAN = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

/**
 * Step 17 of the flow: unlock one episode with Coins. The Coins leave through the shared spend
 * service (main before bonus) and the entitlement row is written in the same transaction, so a
 * member never pays for an episode they cannot open, and the price is kept for a possible refund.
 */
@Injectable()
export class EpisodePurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly auditLog: AuditLogService,
  ) {}

  async purchase(episodeId: string, user: AuthenticatedUser, idempotencyKey?: string): Promise<PurchaseResultDto> {
    const replayed = await this.replayed(episodeId, user.id, idempotencyKey);
    if (replayed) return replayed;

    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: EpisodeStatus.PUBLISHED },
      select: { id: true, movieId: true, episodeNumber: true, coinPrice: true },
    });
    if (!episode) {
      throw new ConflictException({
        message: 'The episode is not published',
        details: { reason: 'EPISODE_NOT_PUBLISHED' },
      });
    }
    if (episode.coinPrice === null) {
      throw new ConflictException({
        message: 'The episode has no Coin price',
        details: { reason: 'EPISODE_NOT_PRICED' },
      });
    }
    await this.assertNotFree(episode);

    const wallet = await this.wallets.walletOf(user.id);
    const { coinRateVnd } = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      await this.assertNotOwned(tx, episode.id, episode.movieId, user.id);
      const movement = await this.coins.spend(tx, wallet.id, {
        entryType: CoinEntryType.EPISODE_PURCHASE,
        amountCoins: episode.coinPrice!,
        coinRateVnd,
        referenceType: CoinReferenceType.EPISODE_ACCESS,
        idempotencyKey,
        description: 'Unlocked one episode',
      });
      const access = await tx.episodeAccess.create({
        data: {
          userId: user.id,
          episodeId: episode.id,
          source: AccessSource.EPISODE_PURCHASE,
          paidCoins: episode.coinPrice!,
          rateVnd: coinRateVnd,
          coinTransactionId: movement.transactionId,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_ACCESS_GRANTED,
          entityType: 'EpisodeAccess',
          entityId: access.id,
          movieId: episode.movieId,
          actorId: user.id,
          payload: {
            episodeId: episode.id,
            paidCoins: episode.coinPrice,
            transactionId: movement.transactionId,
            charged: { mainCoins: movement.mainCoins, bonusCoins: movement.bonusCoins },
          },
        },
        tx,
      );
      return {
        episodeId: episode.id,
        paidCoins: access.paidCoins,
        charged: { mainCoins: movement.mainCoins, bonusCoins: movement.bonusCoins },
        mainBalance: movement.mainBalance,
        bonusBalance: movement.bonusBalance,
        access: { source: access.source, grantedAt: access.grantedAt },
        accessGranted: true,
      };
    });
  }

  /** A Free Starter episode and an episode priced at zero need no purchase at all. */
  private async assertNotFree(episode: { id: string; episodeNumber: number; coinPrice: number | null }) {
    const settings = await this.settings.get();
    if (episode.episodeNumber <= settings.freeStarterEpisodeCount || episode.coinPrice === 0) {
      throw new ConflictException({
        message: 'The episode is free, it needs no purchase',
        details: { reason: 'ACCESS_ALREADY_OWNED' },
      });
    }
  }

  /** The same request sent twice returns the first result instead of charging again. */
  private async replayed(episodeId: string, userId: string, idempotencyKey?: string) {
    if (!idempotencyKey) return null;
    const entry = await this.prisma.coinTransaction.findUnique({
      where: { idempotencyKey },
      include: { episodeAccess: true },
    });
    const access = entry?.episodeAccess;
    if (!access || access.userId !== userId || access.episodeId !== episodeId) return null;
    return {
      episodeId,
      paidCoins: access.paidCoins,
      charged: { mainCoins: -entry.mainAmount, bonusCoins: -entry.bonusAmount },
      mainBalance: entry.mainBalanceAfter,
      bonusBalance: entry.bonusBalanceAfter,
      access: { source: access.source, grantedAt: access.grantedAt },
      accessGranted: true,
      idempotent: true,
    } satisfies PurchaseResultDto;
  }

  /** Anything that already opens the episode: a plan, the episode itself, or the whole series. */
  private async assertNotOwned(tx: PrismaTx, episodeId: string, movieId: string, userId: string) {
    const [episodeAccess, seriesAccess, plan] = await Promise.all([
      tx.episodeAccess.count({ where: { userId, episodeId, revokedAt: null } }),
      tx.seriesAccess.count({ where: { userId, movieId, revokedAt: null } }),
      tx.subscription.count({ where: { userId, status: { in: RUNNING_PLAN } } }),
    ]);
    if (episodeAccess || seriesAccess || plan) {
      throw new ConflictException({
        message: 'The episode is already unlocked',
        details: { reason: 'ACCESS_ALREADY_OWNED' },
      });
    }
  }
}
