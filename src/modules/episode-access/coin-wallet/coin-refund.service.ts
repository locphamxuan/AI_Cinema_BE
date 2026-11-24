import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CoinReferenceType, type CoinTransaction } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { noticeRefunded } from './coin-notices';
import { CoinSpendService } from './coin-spend.service';
import { COIN_REASON, type PaymentRefund, type RefundRequest } from './coin-wallet.types';
import { lockWallet } from './lot-usage';
import { purchaseOf, undoPurchase } from './refunded-purchase';

/** The payments that can be refunded; anything else is corrected with a wallet adjustment. */
const REFUNDABLE: CoinEntryType[] = [
  CoinEntryType.EPISODE_PURCHASE,
  CoinEntryType.PLAN_PAYMENT,
  CoinEntryType.PLAN_RENEWAL,
];

/** Kept on an EpisodeAccess an Admin refund revoked. */
export const ADMIN_REFUND_REASON = 'ADMIN_REFUND';

const sum = (rows: { mainAmount: number; bonusAmount: number }[], part: 'mainAmount' | 'bonusAmount') =>
  rows.reduce((total, row) => total + row[part], 0);

const notRefundable = (entryType: CoinEntryType) =>
  new ConflictException({
    message: 'Only a Coin payment can be refunded; use a wallet adjustment for anything else',
    details: { reason: COIN_REASON.NOT_REFUNDABLE, entryType },
  });

/**
 * The one way a Coin payment is paid back, for the Admin and for the system (BR-52) alike. A payment is
 * every ledger row sharing one payment id - the main part and one row per bonus lot - and it is refunded
 * as a whole, once: the check runs under the wallet lock, a partial unique index backs it, and a second
 * attempt finds the first refund. Main Coins go back as main Coins and bonus Coins as a REFUND lot
 * (never turned into main Coins), and what the payment bought is taken back in the same transaction.
 */
@Injectable()
export class CoinRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** POST /admin/coin-transactions/:id/refund, with any row of the payment; a second refund is a 409. */
  refundByAdmin(transactionId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await this.refundPayment(tx, transactionId, {
        description: 'Refunded by an Admin',
        revokeReason: ADMIN_REFUND_REASON,
        createdById: actorId,
      });
      if (refund.alreadyRefunded) {
        throw new ConflictException({
          message: 'This Coin payment has already been refunded',
          details: {
            reason: COIN_REASON.ALREADY_REFUNDED,
            paymentId: refund.paymentId,
            refundTransactionId: refund.refundTransactionId,
          },
        });
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.COIN_REFUNDED,
          entityType: 'CoinTransaction',
          entityId: refund.paymentId,
          projectId: null,
          actorId,
          payload: { ...refund },
        },
        tx,
      );
      await noticeRefunded(this.notifications, tx, refund);
      // `transactionId` (the REFUND entry) and the balances keep the earlier answer of this endpoint.
      return {
        transactionId: refund.refundTransactionId,
        paymentId: refund.paymentId,
        entryType: refund.entryType,
        mainCoins: refund.mainCoins,
        bonusCoins: refund.bonusCoins,
        mainBalance: refund.mainBalance,
        bonusBalance: refund.bonusBalance,
        episodeAccessId: refund.episodeAccessId,
        subscriptionCycleId: refund.subscriptionCycleId,
        subscriptionEnded: refund.subscriptionEnded,
      };
    });
  }

  /**
   * Refunds the whole payment `transactionId` belongs to, inside the caller's transaction. A payment
   * refunded before comes back with `alreadyRefunded` and moves nothing; the caller decides whether
   * that is an error.
   */
  async refundPayment(
    tx: PrismaTx,
    transactionId: string,
    request: RefundRequest,
    now = new Date(),
  ): Promise<PaymentRefund> {
    const row = await tx.coinTransaction.findUnique({ where: { id: transactionId } });
    if (!row) {
      throw new NotFoundException({
        message: 'Coin transaction not found',
        details: { reason: COIN_REASON.TRANSACTION_NOT_FOUND },
      });
    }
    // Every write to this wallet waits here, so two refunds of one payment at once pay it back once.
    await lockWallet(tx, row.walletId);
    const payment = await this.paymentOf(tx, row);
    const rows = await tx.coinTransaction.findMany({
      where: { OR: [{ id: payment.id }, { paymentId: payment.id }] },
      select: { id: true, mainAmount: true, bonusAmount: true },
    });
    const base = { paymentId: payment.id, entryType: payment.entryType, walletId: payment.walletId };
    // Any row of the payment counts: an older build refunded single rows.
    const earlier = await tx.coinTransaction.findFirst({
      where: { entryType: CoinEntryType.REFUND, reversesId: { in: rows.map((r) => r.id) } },
      orderBy: { createdAt: 'asc' },
    });
    if (earlier) {
      return {
        ...base,
        refundTransactionId: earlier.id,
        alreadyRefunded: true,
        mainCoins: earlier.mainAmount,
        bonusCoins: earlier.bonusAmount,
        mainBalance: null,
        bonusBalance: null,
        episodeAccessId: null,
        subscriptionCycleId: null,
        subscriptionEnded: false,
      };
    }

    const purchase = await purchaseOf(tx, payment);
    // The first row holds the whole main part; the bonus part is the rest of the price kept on what was
    // bought, or the sum of the lot rows when the payment bought nothing still on record.
    const mainCoins = 0 - sum(rows, 'mainAmount');
    const bonusCoins = purchase ? Math.max(purchase.priceCoins - mainCoins, 0) : 0 - sum(rows, 'bonusAmount');
    if (mainCoins + bonusCoins <= 0) throw notRefundable(payment.entryType);
    const movement = await this.coins.credit(
      tx,
      payment.walletId,
      {
        entryType: CoinEntryType.REFUND,
        mainAmount: mainCoins,
        bonusAmount: bonusCoins,
        lotSource: CoinLotSource.REFUND,
        reversesId: payment.id,
        referenceType: referenceOf(purchase?.kind),
        referenceId: purchase?.id,
        createdById: request.createdById,
        description: request.description,
      },
      now,
    );
    const undone = await undoPurchase(tx, purchase, request.revokeReason, now);
    return {
      ...base,
      refundTransactionId: movement.transactionId,
      alreadyRefunded: false,
      mainCoins,
      bonusCoins,
      mainBalance: movement.mainBalance,
      bonusBalance: movement.bonusBalance,
      ...undone,
    };
  }

  /** The first row of the payment a row belongs to; only a Coin payment has one. */
  private async paymentOf(tx: PrismaTx, row: CoinTransaction): Promise<CoinTransaction> {
    if (!row.paymentId && row.lotId && row.bonusAmount < 0 && REFUNDABLE.includes(row.entryType)) {
      throw new ConflictException({
        message: 'This bonus row could not be linked to its payment; refund the payment from its first row',
        details: { reason: COIN_REASON.PAYMENT_NOT_LINKED, transactionId: row.id },
      });
    }
    const payment =
      row.paymentId && row.paymentId !== row.id
        ? await tx.coinTransaction.findUniqueOrThrow({ where: { id: row.paymentId } })
        : row;
    if (!REFUNDABLE.includes(payment.entryType) || payment.mainAmount > 0 || payment.bonusAmount > 0) {
      throw notRefundable(payment.entryType);
    }
    return payment;
  }
}

function referenceOf(kind: 'EPISODE' | 'CYCLE' | undefined): CoinReferenceType | undefined {
  if (kind === 'EPISODE') return CoinReferenceType.EPISODE_ACCESS;
  return kind === 'CYCLE' ? CoinReferenceType.SUBSCRIPTION_CYCLE : undefined;
}
