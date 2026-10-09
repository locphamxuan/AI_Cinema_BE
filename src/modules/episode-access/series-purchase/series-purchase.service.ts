import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  AccessSource,
  CoinEntryType,
  CoinReferenceType,
  EpisodeStatus,
  MovieStatus,
  SubscriptionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';
import type { PurchaseResultDto } from '../episode-purchase/dto/purchase-result.dto';

const RUNNING_PLAN = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

/**
 * Buying every episode of a movie at once. One SeriesAccess row replaces one row per episode,
 * so episodes released later are free for that member too without writing anything.
 */
@Injectable()
export class SeriesPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly auditLog: AuditLogService,
  ) {}

  async purchase(movieId: string, user: AuthenticatedUser, idempotencyKey?: string): Promise<PurchaseResultDto> {
    const replayed = await this.replayed(movieId, user.id, idempotencyKey);
    if (replayed) return replayed;

    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, status: { not: MovieStatus.CANCELLED } },
      select: { id: true, seriesCoinPrice: true },
    });
    if (!movie) {
      throw new UnprocessableEntityException({ message: 'Movie not found', details: { reason: 'SERIES_NOT_SOLD' } });
    }
    // A movie without a bundle price is not sold as a series, whatever the per-episode prices are.
    if (movie.seriesCoinPrice === null) {
      throw new UnprocessableEntityException({
        message: 'This movie is not sold as a series',
        details: { reason: 'SERIES_NOT_SOLD' },
      });
    }

    const wallet = await this.wallets.walletOf(user.id);
    const { coinRateVnd } = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      await this.assertNotOwned(tx, movie.id, user.id);
      const movement = await this.coins.spend(tx, wallet.id, {
        entryType: CoinEntryType.SERIES_PURCHASE,
        amountCoins: movie.seriesCoinPrice!,
        coinRateVnd,
        referenceType: CoinReferenceType.SERIES_ACCESS,
        idempotencyKey,
        description: 'Unlocked a whole series',
      });
      const access = await tx.seriesAccess.create({
        data: {
          userId: user.id,
          movieId: movie.id,
          source: AccessSource.SERIES_PURCHASE,
          paidCoins: movie.seriesCoinPrice!,
          rateVnd: coinRateVnd,
          coinTransactionId: movement.transactionId,
        },
      });
      // What the bundle actually opens today; episodes released later come along for free.
      const unlockedEpisodes = await tx.episode.count({
        where: { movieId: movie.id, status: EpisodeStatus.PUBLISHED },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SERIES_ACCESS_GRANTED,
          entityType: 'SeriesAccess',
          entityId: access.id,
          movieId: movie.id,
          actorId: user.id,
          payload: {
            paidCoins: movie.seriesCoinPrice,
            transactionId: movement.transactionId,
            charged: { mainCoins: movement.mainCoins, bonusCoins: movement.bonusCoins },
            unlockedEpisodes,
          },
        },
        tx,
      );
      return {
        movieId: movie.id,
        paidCoins: access.paidCoins,
        charged: { mainCoins: movement.mainCoins, bonusCoins: movement.bonusCoins },
        mainBalance: movement.mainBalance,
        bonusBalance: movement.bonusBalance,
        access: { source: access.source, grantedAt: access.grantedAt },
        accessGranted: true,
        unlockedEpisodes,
      };
    });
  }

  private async replayed(movieId: string, userId: string, idempotencyKey?: string) {
    if (!idempotencyKey) return null;
    const entry = await this.prisma.coinTransaction.findUnique({
      where: { idempotencyKey },
      include: { seriesAccess: true },
    });
    const access = entry?.seriesAccess;
    if (!access || access.userId !== userId || access.movieId !== movieId) return null;
    return {
      movieId,
      paidCoins: access.paidCoins,
      charged: { mainCoins: -entry.mainAmount, bonusCoins: -entry.bonusAmount },
      mainBalance: entry.mainBalanceAfter,
      bonusBalance: entry.bonusBalanceAfter,
      access: { source: access.source, grantedAt: access.grantedAt },
      accessGranted: true,
      idempotent: true,
    } satisfies PurchaseResultDto;
  }

  /** A member already inside the movie, either by plan or by one bought episode, buys no bundle. */
  private async assertNotOwned(tx: PrismaTx, movieId: string, userId: string) {
    const [seriesAccess, plan, ownedEpisodes] = await Promise.all([
      tx.seriesAccess.count({ where: { userId, movieId, revokedAt: null } }),
      tx.subscription.count({ where: { userId, status: { in: RUNNING_PLAN } } }),
      tx.episodeAccess.count({ where: { userId, episode: { movieId }, revokedAt: null } }),
    ]);
    if (seriesAccess || plan || ownedEpisodes) {
      throw new ConflictException({
        message: 'The series is already unlocked',
        details: { reason: 'SERIES_ACCESS_ALREADY_OWNED' },
      });
    }
  }
}
