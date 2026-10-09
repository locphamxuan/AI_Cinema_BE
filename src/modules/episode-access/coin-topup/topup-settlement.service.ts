import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CoinReferenceType, PaymentStatus, TopUpStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { TOPUP_REASON } from './constants/topup-reason';
import { ORDER_VIEW, orderView, PAYMENT_VIEW } from './utils/order-view';

/**
 * The money-moving side of top-ups: crediting the wallet once the gateway confirms,
 * and mirroring failures onto the order. Everything runs inside transactions so the
 * ledger, the attempt and the order never drift apart.
 */
@Injectable()
export class TopUpSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Settles the payment attempt the gateway confirmed. Called at most once per attempt: a second
   * call finds it already PAID and reports TOPUP_ALREADY_SETTLED instead of crediting again.
   */
  async settle(input: {
    paymentId: string;
    providerPaymentId: string;
    amountVnd: number;
    idempotencyKey: string;
    paidAt?: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        select: PAYMENT_VIEW,
      });
      if (payment.status === PaymentStatus.PAID) {
        throw new UnprocessableEntityException({
          message: 'The order has already been paid',
          details: { reason: TOPUP_REASON.ALREADY_SETTLED, topUpId: payment.coinTopUpId, paymentId: payment.id },
        });
      }
      if (payment.status !== PaymentStatus.PENDING) {
        throw new UnprocessableEntityException({
          message: 'The payment is no longer payable',
          details: { reason: TOPUP_REASON.NOT_PAYABLE, status: payment.status, paymentId: payment.id },
        });
      }
      const topUp = await tx.coinTopUp.findUniqueOrThrow({
        where: { id: payment.coinTopUpId },
        select: ORDER_VIEW,
      });
      if (topUp.status !== TopUpStatus.PENDING) {
        throw new UnprocessableEntityException({
          message: 'The order is no longer payable',
          details: { reason: TOPUP_REASON.NOT_PAYABLE, status: topUp.status, topUpId: topUp.id },
        });
      }
      if (input.amountVnd !== payment.amountVnd) {
        const failureReason = `The gateway reported ${input.amountVnd} VND instead of ${payment.amountVnd} VND`;
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, failureReason } });
        await tx.coinTopUp.update({ where: { id: topUp.id }, data: { status: TopUpStatus.FAILED, failureReason } });
        throw new UnprocessableEntityException({
          message: 'The settled amount does not match the order',
          details: {
            reason: TOPUP_REASON.AMOUNT_MISMATCH,
            expectedVnd: payment.amountVnd,
            settledVnd: input.amountVnd,
          },
        });
      }
      const movement = await this.coins.credit(
        tx,
        topUp.walletId,
        {
          entryType: CoinEntryType.TOP_UP,
          mainAmount: topUp.coinsGranted,
          // A top-up pays main Coins; a promotion the Admin sets up is what opens a lot.
          lotSource: CoinLotSource.TOP_UP_PROMO,
          referenceType: CoinReferenceType.COIN_TOP_UP,
          referenceId: topUp.id,
          idempotencyKey: input.idempotencyKey,
          rateVnd: topUp.rateVnd,
          description: `Top-up ${payment.provider}`,
        },
        input.paidAt,
      );
      const settledPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          providerPaymentId: input.providerPaymentId,
          paidAt: input.paidAt ?? new Date(),
        },
        select: PAYMENT_VIEW,
      });
      const settledOrder = await tx.coinTopUp.update({
        where: { id: topUp.id },
        data: { status: TopUpStatus.PAID, coinTransactionId: movement.transactionId },
        select: ORDER_VIEW,
      });
      await this.notifications.notify(
        [topUp.userId],
        {
          type: NOTIFICATION_TYPE.COIN_TOPUP_SUCCESS,
          title: `Đã nạp ${topUp.coinsGranted} Coin`,
          body: `Thanh toán ${topUp.amountVnd.toLocaleString('vi-VN')} VND qua ${payment.provider} đã thành công.`,
          link: '/wallet',
          payload: { topUpId: topUp.id, coinsGranted: topUp.coinsGranted },
        },
        tx,
      );
      return orderView(settledOrder, settledPayment);
    });
  }

  /** The gateway reports the member gave up, or gave the wrong amount. The order mirrors it. */
  async markPaymentFailed(paymentId: string, reason: string, status: Extract<PaymentStatus, 'FAILED' | 'CANCELLED'>) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { coinTopUpId: true } });
      const updated = await tx.payment.update({ where: { id: paymentId }, data: { status, failureReason: reason } });
      await tx.coinTopUp.update({
        where: { id: payment.coinTopUpId },
        data: {
          status: status === PaymentStatus.FAILED ? TopUpStatus.FAILED : TopUpStatus.CANCELLED,
          failureReason: reason,
        },
      });
      return updated;
    });
  }
}
