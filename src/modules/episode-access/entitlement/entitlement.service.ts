import { Injectable } from '@nestjs/common';
import { AccessSource, CoinEntryType, CoinLotSource, CoinReferenceType, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { CoinRefundService } from '../coin-wallet/coin-refund.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { lockWallet } from '../coin-wallet/lot-usage';
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

/** An unlock bought with Coins that a take-down pays back. */
interface DueAccess {
  id: string;
  userId: string;
  paidCoins: number;
  coinTransactionId: string | null;
  episode: { movieId: string };
}

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
 * down for good is paid back main and bonus as they were spent, once, and the refund points back at
 * the payment it reverses.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly refunds: CoinRefundService,
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

  private async refundEpisode(tx: PrismaTx, access: DueAccess, episodeId: string, reason: string): Promise<void> {
    // The wallet lock first, then the unlock: the order an Admin refund takes too, so the two never
    // deadlock, and whichever comes second finds the purchase revoked and refunded.
    const wallet = await this.wallets.walletOf(access.userId, tx);
    await lockWallet(tx, wallet.id);
    const { count } = await tx.episodeAccess.updateMany({
      where: { id: access.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    if (count === 0) return;
    const refunded = await this.refund(tx, access, wallet.id, reason);
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.EPISODE_ACCESS_REVOKED,
        entityType: 'EpisodeAccess',
        entityId: access.id,
        projectId: access.episode.movieId,
        actorId: null,
        payload: { episodeId, reason, refundedCoins: refunded?.coins ?? 0, transactionId: refunded?.transactionId },
      },
      tx,
    );
    if (refunded) await this.notifyRefund(tx, access.userId, refunded.coins, reason, { episodeId });
  }

  /**
   * Pays a purchase back exactly as it was paid (BR-52): the whole payment, main Coins to the main
   * balance and bonus Coins back as bonus Coins, through the same refund an Admin uses, so a payment
   * is never refunded twice. Null when nothing moved: a free unlock, or a payment refunded before.
   */
  private async refund(
    tx: PrismaTx,
    access: DueAccess,
    walletId: string,
    reason: string,
  ): Promise<{ transactionId: string; coins: number } | null> {
    if (access.paidCoins <= 0) return null;
    const description = `Refund: the content was taken down for good (${reason})`;
    if (access.coinTransactionId) {
      const refund = await this.refunds.refundPayment(tx, access.coinTransactionId, {
        description,
        revokeReason: reason,
      });
      if (refund.alreadyRefunded) return null;
      return { transactionId: refund.refundTransactionId, coins: refund.mainCoins + refund.bonusCoins };
    }
    // An unlock with no ledger entry (older data): the whole price goes back as main Coins. The row
    // was revoked above, so this runs once.
    const movement = await this.coins.credit(tx, walletId, {
      entryType: CoinEntryType.REFUND,
      mainAmount: access.paidCoins,
      lotSource: CoinLotSource.REFUND,
      referenceType: CoinReferenceType.EPISODE_ACCESS,
      referenceId: access.id,
      description,
    });
    return { transactionId: movement.transactionId, coins: access.paidCoins };
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
