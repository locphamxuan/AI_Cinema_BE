import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CoinEntryType,
  CoinLotSource,
  CoinReferenceType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  TopUpStatus,
} from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';
import { TOPUP_REASON } from './constants/topup-reason';
import { ORDER_VIEW, orderView, type OrderRow, type OrderWithPayments, PAYMENT_VIEW } from './utils/order-view';
import { isUuid, normalizeCallback, type GatewayCallback } from './utils/payment-callback.util';
import { redirectOf } from './utils/payment-provider.util';

export { TOPUP_REASON };
export type { GatewayCallback };

/** How long a pending order may sit before the sweeper gives up on it. */
const ORDER_TTL_MINUTES = 15;

/**
 * Step 12: Coins bought with a gateway. The order row (`CoinTopUp`: what the member asked for)
 * is written before the member is sent to the gateway, and one payment row (`Payment`: what a
 * gateway did about it) is opened per attempt. The ledger entry only lands when the gateway
 * confirms, so the amount agreed on and the amount credited cannot drift. Top-ups credit main
 * Coins: bonus Coins only come from a promotion an Admin sets up on purpose, so they always
 * expire.
 */
@Injectable()
export class CoinTopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly notifications: NotificationService,
  ) {}

  /** Creates the order with its first payment attempt and hands back where to send the member. */
  async create(userId: string, provider: PaymentProvider, amountVnd: number) {
    const { coinTopUpMinVnd, coinTopUpMaxVnd, coinRateVnd } = await this.settings.get();
    if (amountVnd < coinTopUpMinVnd || amountVnd > coinTopUpMaxVnd) {
      throw new UnprocessableEntityException({
        message: 'The amount is outside the accepted range',
        details: { reason: TOPUP_REASON.AMOUNT_OUT_OF_RANGE, coinTopUpMinVnd, coinTopUpMaxVnd, amountVnd },
      });
    }
    const wallet = await this.wallets.walletOf(userId);
    // Round down: the gateway charges the VND amount, so the Coins promised cannot exceed it.
    const coinsGranted = Math.floor(amountVnd / coinRateVnd);
    // Unique per provider, so a replayed callback finds its attempt and cannot credit twice.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    const providerTxnId = `${provider}-${stamp}`;
    const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60_000);
    return this.prisma.$transaction(async (tx) => {
      const topUp = await tx.coinTopUp.create({
        data: { userId, walletId: wallet.id, amountVnd, coinsGranted, rateVnd: coinRateVnd, expiresAt },
        select: ORDER_VIEW,
      });
      const payment = await tx.payment.create({
        data: {
          userId,
          coinTopUpId: topUp.id,
          provider,
          providerTxnId,
          amountVnd,
          redirectUrl: redirectOf(provider, providerTxnId, amountVnd),
          expiresAt,
        },
        select: PAYMENT_VIEW,
      });
      return orderView(topUp, payment);
    });
  }

  listMine(userId: string, query: PaginateQuery) {
    return paginate(query, this.prisma.coinTopUp, {
      where: { userId },
      select: Object.keys(ORDER_VIEW) as (keyof OrderRow)[],
      relations: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
      sortableColumns: ['createdAt', 'amountVnd', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'] },
    }).then((page) => ({
      ...page,
      data: (page.data as unknown as OrderWithPayments[]).map((row) => orderView(row, row.payments[0] ?? null)),
    }));
  }

  async findMine(userId: string, topUpId: string) {
    const topUp = await this.prisma.coinTopUp.findFirst({
      where: { id: topUpId, userId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    const row = topUp as unknown as OrderWithPayments;
    return orderView(row, row.payments[0] ?? null);
  }

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

  /**
   * A gateway webhook delivery. Idempotent on (provider, event_id): a repeated delivery answers
   * with the same order and never credits twice. A delivery for an attempt already PAID answers
   * the order as well, so the gateway may retry freely.
   */
  async handleCallback(provider: PaymentProvider, raw: Record<string, unknown>) {
    const callback = normalizeCallback(raw);
    const replayed = await this.prisma.paymentCallback.findUnique({
      where: { provider_eventId: { provider, eventId: callback.eventId } },
      select: { topUpId: true, handledAt: true },
    });
    if (replayed?.handledAt) return this.topUpView(replayed.topUpId);
    const { payment, topUp } = await this.resolvePayment(provider, callback);
    if (!replayed) {
      try {
        await this.prisma.paymentCallback.create({
          data: {
            topUpId: topUp.id,
            paymentId: payment.id,
            provider,
            eventId: callback.eventId,
            signature: callback.signature,
            payload: raw as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        const winner = await this.prisma.paymentCallback.findUnique({
          where: { provider_eventId: { provider, eventId: callback.eventId } },
          select: { topUpId: true, handledAt: true },
        });
        // Another delivery won the race and finished: answer with the same order it gives.
        if (winner?.handledAt) return this.topUpView(winner.topUpId);
        // The winner crashed before handling: fall through and finish the work exactly once.
      }
    }
    const handled = (patch: Prisma.PaymentCallbackUpdateInput) =>
      this.prisma.paymentCallback.update({
        where: { provider_eventId: { provider, eventId: callback.eventId } },
        data: patch,
      });
    if (payment.status === PaymentStatus.PAID) {
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (payment.status !== PaymentStatus.PENDING || topUp.status !== TopUpStatus.PENDING) {
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (callback.status !== 'success') {
      await this.markPaymentFailed(
        payment.id,
        `The gateway reported the payment as ${callback.status}`,
        callback.status === 'cancelled' ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
      );
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (callback.amountVnd !== payment.amountVnd) {
      const failureReason = `The gateway reported ${callback.amountVnd} VND instead of ${payment.amountVnd} VND`;
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason },
      });
      await this.prisma.coinTopUp.update({
        where: { id: topUp.id },
        data: { status: TopUpStatus.FAILED, failureReason },
      });
      await handled({ handledAt: new Date(), errorMessage: failureReason });
      throw new UnprocessableEntityException({
        message: 'The settled amount does not match the order',
        details: {
          reason: TOPUP_REASON.AMOUNT_MISMATCH,
          expectedVnd: payment.amountVnd,
          settledVnd: callback.amountVnd,
        },
      });
    }
    try {
      const settled = await this.settle({
        paymentId: payment.id,
        providerPaymentId: callback.providerPaymentId ?? callback.eventId,
        amountVnd: callback.amountVnd,
        // One credit per order: the same delivery twice replays the same ledger row.
        idempotencyKey: `topup:${topUp.id}`,
        paidAt: callback.paidAt,
      });
      await handled({ handledAt: new Date() });
      return settled;
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException &&
        (error.getResponse() as { details?: { reason?: string } })?.details?.reason === TOPUP_REASON.ALREADY_SETTLED
      ) {
        await handled({ handledAt: new Date() });
        return this.topUpView(topUp.id);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent delivery credited the order first; answer with the settled order.
        await handled({ handledAt: new Date() });
        return this.topUpView(topUp.id);
      }
      await handled({ handledAt: new Date(), errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /** An order for the return trip or the support screen: any order of the provider, any owner. */
  async findForReturn(provider: PaymentProvider, ref: { topUpId?: string; providerTxnId?: string }) {
    if (ref.topUpId && !isUuid(ref.topUpId)) {
      throw new BadRequestException({
        message: 'The top-up reference is not a valid id',
        details: { reason: TOPUP_REASON.INVALID_CALLBACK },
      });
    }
    if (ref.topUpId) {
      const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: ref.topUpId }, select: ORDER_VIEW });
      if (!topUp)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      const payment = await this.latestPaymentOf(topUp.id, provider);
      if (!payment)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      return orderView(topUp, payment);
    }
    if (ref.providerTxnId) {
      const payment = await this.prisma.payment.findUnique({
        where: { provider_providerTxnId: { provider, providerTxnId: ref.providerTxnId } },
        select: PAYMENT_VIEW,
      });
      if (!payment)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      const topUp = await this.prisma.coinTopUp.findUniqueOrThrow({
        where: { id: payment.coinTopUpId },
        select: ORDER_VIEW,
      });
      return orderView(topUp, payment);
    }
    throw new BadRequestException({
      message: 'The return trip needs a topUpId or a providerTxnId',
      details: { reason: TOPUP_REASON.INVALID_CALLBACK },
    });
  }

  /** The payment attempt a callback points at, with the order it belongs to. */
  private async resolvePayment(provider: PaymentProvider, callback: GatewayCallback) {
    if (callback.providerTxnId) {
      const payment = await this.prisma.payment.findUnique({
        where: { provider_providerTxnId: { provider, providerTxnId: callback.providerTxnId } },
        select: PAYMENT_VIEW,
      });
      if (payment) {
        if (callback.topUpId && callback.topUpId !== payment.coinTopUpId) {
          throw new BadRequestException({
            message: 'The callback points at two different orders',
            details: { reason: TOPUP_REASON.INVALID_CALLBACK },
          });
        }
        const topUp = await this.prisma.coinTopUp.findUnique({
          where: { id: payment.coinTopUpId },
          select: ORDER_VIEW,
        });
        if (!topUp)
          throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
        return { payment, topUp };
      }
    }
    if (callback.topUpId && isUuid(callback.topUpId)) {
      const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: callback.topUpId }, select: ORDER_VIEW });
      if (topUp) {
        const payment = await this.prisma.payment.findFirst({
          where: { coinTopUpId: topUp.id, provider },
          orderBy: { createdAt: 'desc' },
          select: PAYMENT_VIEW,
        });
        if (payment) return { payment, topUp };
      }
    }
    throw new NotFoundException({
      message: 'Payment not found',
      details: { reason: TOPUP_REASON.PAYMENT_NOT_FOUND },
    });
  }

  /** The newest attempt of one provider on an order: retries never run side by side. */
  private async latestPaymentOf(topUpId: string, provider: PaymentProvider) {
    return this.prisma.payment.findFirst({
      where: { coinTopUpId: topUpId, provider },
      orderBy: { createdAt: 'desc' },
      select: PAYMENT_VIEW,
    });
  }

  /** One order with its newest attempt, or null when it never reached a gateway. */
  private async latestPayment(topUpId: string) {
    return this.prisma.payment.findFirst({
      where: { coinTopUpId: topUpId },
      orderBy: { createdAt: 'desc' },
      select: PAYMENT_VIEW,
    });
  }

  private async topUpView(topUpId: string | null | undefined) {
    if (!topUpId)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: topUpId }, select: ORDER_VIEW });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    return orderView(topUp, await this.latestPayment(topUp.id));
  }
}
