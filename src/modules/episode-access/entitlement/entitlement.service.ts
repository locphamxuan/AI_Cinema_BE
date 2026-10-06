import { Injectable } from '@nestjs/common';
import { AccessSource, CoinEntryType, CoinLotSource, CoinReferenceType, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';

/** What the caller may filter the "my unlocks" list by. */
export interface AccessListFilter {
  userId: string;
  source?: AccessSource;
}

/** One bought episode with just enough of its episode and movie to render a library card. */
const EPISODE_VIEW = {
  episode: {
    select: {
      id: true,
      movieId: true,
      episodeNumber: true,
      title: true,
      thumbnailUrl: true,
      movie: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  },
} satisfies Prisma.EpisodeAccessInclude;

type EpisodeAccessRow = Prisma.EpisodeAccessGetPayload<{ include: typeof EPISODE_VIEW }>;

const lineOf = (row: EpisodeAccessRow) => ({
  id: row.id,
  source: row.source,
  paidCoins: row.paidCoins,
  grantedAt: row.grantedAt,
  episode: row.episode,
  movie: row.episode.movie,
});

/**
 * What a member has unlocked, and the refund that follows a take-down. BR-52: an episode taken
 * down for good is paid back, so nobody is left having paid for something that is gone. The refund
 * always lands in main Coins, which never expire, and points back at the purchase it reverses.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The library screen: episodes bought one by one, and series bought as a bundle. */
  async listFor(filter: AccessListFilter, query: PaginateQuery) {
    const where = { userId: filter.userId, revokedAt: null, ...(filter.source ? { source: filter.source } : {}) };
    const [episodes, series] = await Promise.all([
      paginate(query, this.prisma.episodeAccess, {
        where,
        relations: EPISODE_VIEW,
        sortableColumns: ['grantedAt', 'paidCoins'],
        defaultSortBy: [['grantedAt', 'DESC']],
        filterableColumns: { source: ['$eq', '$in'] },
      }),
      this.prisma.seriesAccess.findMany({
        where,
        orderBy: { grantedAt: 'desc' },
        include: { movie: { select: { id: true, title: true, posterUrl: true } } },
      }),
    ]);
    return {
      episodes: { ...episodes, data: (episodes.data as EpisodeAccessRow[]).map(lineOf) },
      series: series.map((row) => ({
        id: row.id,
        source: row.source,
        paidCoins: row.paidCoins,
        grantedAt: row.grantedAt,
        movie: row.movie,
      })),
    };
  }

  /**
   * Called from publishing when an episode is taken down for good: every member who bought that
   * episode with Coins is paid back, unless the platform has refunds switched off.
   */
  async refundEpisodeRemoval(tx: PrismaTx, episodeId: string, reason: string): Promise<number> {
    const due = await tx.episodeAccess.findMany({
      where: { episodeId, revokedAt: null, source: AccessSource.EPISODE_PURCHASE },
      select: {
        id: true,
        userId: true,
        paidCoins: true,
        coinTransactionId: true,
        episode: { select: { movieId: true } },
      },
    });
    for (const access of due) await this.refundEpisode(tx, access, episodeId, reason);
    return due.length;
  }

  /** The same for a movie taken down for good: the bundle every member bought is paid back. */
  async refundSeriesRemoval(tx: PrismaTx, movieId: string, reason: string): Promise<number> {
    const due = await tx.seriesAccess.findMany({
      where: { movieId, revokedAt: null, source: AccessSource.SERIES_PURCHASE },
      select: { id: true, userId: true, movieId: true, paidCoins: true, coinTransactionId: true },
    });
    for (const access of due) await this.refundSeries(tx, access, reason);
    return due.length;
  }

  private async refundEpisode(
    tx: PrismaTx,
    access: {
      id: string;
      userId: string;
      paidCoins: number;
      coinTransactionId: string | null;
      episode: { movieId: string };
    },
    episodeId: string,
    reason: string,
  ): Promise<void> {
    const movement = await this.refund(tx, access, 'EPISODE_ACCESS', reason);
    await tx.episodeAccess.update({ where: { id: access.id }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.EPISODE_ACCESS_REVOKED,
        entityType: 'EpisodeAccess',
        entityId: access.id,
        movieId: access.episode.movieId,
        actorId: null,
        payload: { episodeId, reason, refundedCoins: access.paidCoins, transactionId: movement },
      },
      tx,
    );
    await this.notifyRefund(tx, access.userId, access.paidCoins, reason, { episodeId });
  }

  private async refundSeries(
    tx: PrismaTx,
    access: { id: string; userId: string; movieId: string; paidCoins: number; coinTransactionId: string | null },
    reason: string,
  ): Promise<void> {
    const movement = await this.refund(tx, access, 'SERIES_ACCESS', reason);
    await tx.seriesAccess.update({ where: { id: access.id }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.SERIES_ACCESS_REVOKED,
        entityType: 'SeriesAccess',
        entityId: access.id,
        movieId: access.movieId,
        actorId: null,
        payload: { reason, refundedCoins: access.paidCoins, transactionId: movement },
      },
      tx,
    );
    await this.notifyRefund(tx, access.userId, access.paidCoins, reason, { movieId: access.movieId });
  }

  /** Pays a purchase back into main Coins and returns the ledger entry that did it. */
  private async refund(
    tx: PrismaTx,
    access: { userId: string; id: string; paidCoins: number; coinTransactionId: string | null },
    referenceType: 'EPISODE_ACCESS' | 'SERIES_ACCESS',
    reason: string,
  ): Promise<string | undefined> {
    if (access.paidCoins <= 0) return undefined;
    const wallet = await this.wallets.walletOf(access.userId, tx);
    const movement = await this.coins.credit(tx, wallet.id, {
      entryType: CoinEntryType.REFUND,
      mainAmount: access.paidCoins,
      lotSource: CoinLotSource.REFUND,
      referenceType: CoinReferenceType[referenceType],
      referenceId: access.id,
      reversesId: access.coinTransactionId ?? undefined,
      description: `Refund: the content was taken down for good (${reason})`,
    });
    return movement.transactionId;
  }

  private async notifyRefund(
    tx: PrismaTx,
    userId: string,
    coins: number,
    reason: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.notifications.notify(
      [userId],
      {
        type: NOTIFICATION_TYPE.EPISODE_ACCESS_REFUNDED,
        title: `Đã hoàn ${coins} Coin`,
        body: `Nội dung bị gỡ vĩnh viễn (${reason}). ${coins} Coin đã được hoàn vào ví chính.`,
        link: '/wallet',
        payload: { refundedCoins: coins, ...payload },
      },
      tx,
    );
  }
}
