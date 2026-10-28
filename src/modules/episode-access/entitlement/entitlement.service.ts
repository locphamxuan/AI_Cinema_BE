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
 * down for good is paid back main and bonus as they were spent, and the refund points back at the
 * purchase it reverses.
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

  /** The library screen: the episodes the member bought with Coins. */
  async listFor(filter: AccessListFilter, query: PaginateQuery) {
    const where = { userId: filter.userId, revokedAt: null, ...(filter.source ? { source: filter.source } : {}) };
    const episodes = await paginate(query, this.prisma.episodeAccess, {
      where,
      relations: EPISODE_VIEW,
      sortableColumns: ['grantedAt', 'paidCoins'],
      defaultSortBy: [['grantedAt', 'DESC']],
      filterableColumns: { source: ['$eq', '$in'] },
    });
    return { ...episodes, data: (episodes.data as EpisodeAccessRow[]).map(lineOf) };
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
    const movement = await this.refund(tx, access, reason);
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

  /**
   * Pays a purchase back exactly as it was paid (BR-52): the main Coins to the main balance, the
   * bonus Coins to a new bonus lot with the default expiry, so a refund never turns promotion
   * Coins into main Coins. Returns the ledger entry that did it.
   */
  private async refund(
    tx: PrismaTx,
    access: { userId: string; id: string; paidCoins: number; coinTransactionId: string | null },
    reason: string,
  ): Promise<string | undefined> {
    if (access.paidCoins <= 0) return undefined;
    const paid = access.coinTransactionId
      ? await tx.coinTransaction.findUnique({
          where: { id: access.coinTransactionId },
          select: { mainAmount: true },
        })
      : null;
    // The linked entry is the first row of the debit: it holds the whole main part (negative) and
    // the bonus left on the lot rows after it, so the bonus paid is the rest of the price.
    // Without the entry the whole price goes back as main.
    const mainAmount = paid ? 0 - paid.mainAmount : access.paidCoins;
    const bonusAmount = access.paidCoins - mainAmount;
    const wallet = await this.wallets.walletOf(access.userId, tx);
    const movement = await this.coins.credit(tx, wallet.id, {
      entryType: CoinEntryType.REFUND,
      mainAmount,
      bonusAmount,
      lotSource: CoinLotSource.REFUND,
      referenceType: CoinReferenceType.EPISODE_ACCESS,
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
        body: `Nội dung bị gỡ vĩnh viễn (${reason}). ${coins} Coin đã được hoàn vào ví.`,
        link: '/wallet',
        payload: { refundedCoins: coins, ...payload },
      },
      tx,
    );
  }
}
