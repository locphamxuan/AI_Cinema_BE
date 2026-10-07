import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, Prisma, TopUpStatus } from '@prisma/client';
import type { PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { WalletService } from '../coin-wallet/wallet.service';
import { TOPUP_REASON } from './constants/topup-reason';
import { ORDER_VIEW, orderView, PAYMENT_VIEW } from './utils/order-view';
import { normalizeCallback, type GatewayCallback } from './utils/payment-callback.util';
import { PaymentGatewayService } from './gateways/payment-gateway.service';
import { VNPAY_RSP } from './gateways/vnpay-signing';
import { TopUpLookupService } from './topup-lookup.service';
import { TopUpSettlementService } from './topup-settlement.service';

export { TOPUP_REASON };
export type { GatewayCallback };

/** How long a pending order may sit before the sweeper gives up on it. */
const ORDER_TTL_MINUTES = 15;

/**
 * Step 12: Coins bought with a gateway. This service owns the flow — quoting the order,
 * handing the member to the gateway, and routing webhooks — while `TopUpLookupService`
 * answers reads and `TopUpSettlementService` moves the money.
 */
@Injectable()
export class CoinTopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly gateways: PaymentGatewayService,
    private readonly lookups: TopUpLookupService,
    private readonly settlement: TopUpSettlementService,
  ) {}

  /**
   * Creates the order with its first payment attempt and hands back where to send the member.
   * `clientIp` ends up in the VNPay order; MoMo does not need it.
   */
  async create(userId: string, provider: PaymentProvider, amountVnd: number, clientIp?: string) {
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
    const created = await this.prisma.$transaction(async (tx) => {
      const topUp = await tx.coinTopUp.create({
        data: { userId, walletId: wallet.id, amountVnd, coinsGranted, rateVnd: coinRateVnd, expiresAt },
        select: ORDER_VIEW,
      });
      const payment = await tx.payment.create({
        data: { userId, coinTopUpId: topUp.id, provider, providerTxnId, amountVnd, expiresAt },
        select: PAYMENT_VIEW,
      });
      return { topUp, payment };
    });
    // The payment link comes from the gateway, outside any DB transaction: a gateway
    // outage must never hold database locks. A failed link fails the attempt outright.
    let redirectUrl: string;
    try {
      redirectUrl = await this.gateways.createPaymentUrl({
        provider,
        providerTxnId,
        amountVnd,
        topUpId: created.topUp.id,
        clientIp,
        expiresAt,
      });
    } catch (error) {
      await this.settlement.markPaymentFailed(
        created.payment.id,
        error instanceof Error ? error.message : 'The gateway did not return a payment link',
        PaymentStatus.FAILED,
      );
      throw error;
    }
    const paid = await this.prisma.payment.update({
      where: { id: created.payment.id },
      data: { redirectUrl },
      select: PAYMENT_VIEW,
    });
    return orderView(created.topUp, paid);
  }

  /** The member's orders, newest attempt attached to each. */
  listMine(userId: string, query: PaginateQuery) {
    return this.lookups.listMine(userId, query);
  }

  /** One of the member's own orders, with its newest attempt. */
  findMine(userId: string, topUpId: string) {
    return this.lookups.findMine(userId, topUpId);
  }

  /** An order for the return trip or the support screen: any order of the provider, any owner. */
  findForReturn(provider: PaymentProvider, ref: { topUpId?: string; providerTxnId?: string }) {
    return this.lookups.findForReturn(provider, ref);
  }

  /** Settles the payment attempt the gateway confirmed; a second call replays instead of paying twice. */
  settle(input: {
    paymentId: string;
    providerPaymentId: string;
    amountVnd: number;
    idempotencyKey: string;
    paidAt?: Date;
  }) {
    return this.settlement.settle(input);
  }

  /** The gateway reports the member gave up, or gave the wrong amount. The order mirrors it. */
  markPaymentFailed(paymentId: string, reason: string, status: Extract<PaymentStatus, 'FAILED' | 'CANCELLED'>) {
    return this.settlement.markPaymentFailed(paymentId, reason, status);
  }

  /**
   * A gateway webhook delivery. Idempotent on (provider, event_id): a repeated delivery answers
   * with the same order and never credits twice. A delivery for an attempt already PAID answers
   * the order as well, so the gateway may retry freely.
   */
  async handleCallback(provider: PaymentProvider, raw: Record<string, unknown>) {
    const callback = normalizeCallback(raw);
    if (!this.gateways.verifyCallbackSignature(provider, raw)) {
      await this.prisma.paymentCallback.upsert({
        where: { provider_eventId: { provider, eventId: callback.eventId } },
        update: { errorMessage: 'Invalid gateway signature', handledAt: new Date() },
        create: {
          provider,
          eventId: callback.eventId,
          signature: callback.signature,
          payload: raw as Prisma.InputJsonValue,
          errorMessage: 'Invalid gateway signature',
          handledAt: new Date(),
        },
      });
      throw new BadRequestException({
        message: 'The callback signature does not check out',
        details: { reason: TOPUP_REASON.INVALID_SIGNATURE, provider },
      });
    }
    const replayed = await this.prisma.paymentCallback.findUnique({
      where: { provider_eventId: { provider, eventId: callback.eventId } },
      select: { topUpId: true, handledAt: true },
    });
    if (replayed?.handledAt) return this.lookups.topUpView(replayed.topUpId);
    const { payment, topUp } = await this.lookups.resolvePayment(provider, callback);
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
        if (winner?.handledAt) return this.lookups.topUpView(winner.topUpId);
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
      return this.lookups.topUpView(topUp.id);
    }
    if (payment.status !== PaymentStatus.PENDING || topUp.status !== TopUpStatus.PENDING) {
      await handled({ handledAt: new Date() });
      return this.lookups.topUpView(topUp.id);
    }
    if (callback.status !== 'success') {
      await this.settlement.markPaymentFailed(
        payment.id,
        `The gateway reported the payment as ${callback.status}`,
        callback.status === 'cancelled' ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
      );
      await handled({ handledAt: new Date() });
      return this.lookups.topUpView(topUp.id);
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
      const settled = await this.settlement.settle({
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
        return this.lookups.topUpView(topUp.id);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent delivery credited the order first; answer with the settled order.
        await handled({ handledAt: new Date() });
        return this.lookups.topUpView(topUp.id);
      }
      await handled({ handledAt: new Date(), errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * One attempt by gateway reference, with its order. Read-only: the VNPay IPN uses it
   * to answer "already confirmed" without touching anything.
   */
  async peekAttempt(provider: PaymentProvider, providerTxnId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { provider_providerTxnId: { provider, providerTxnId } },
      select: PAYMENT_VIEW,
    });
    if (!payment) return null;
    const topUp = await this.prisma.coinTopUp.findUnique({
      where: { id: payment.coinTopUpId },
      select: ORDER_VIEW,
    });
    if (!topUp) return null;
    return { payment, topUp };
  }

  /**
   * The VNPay server-to-server IPN (always a GET query). Answers in VNPay's own
   * `{RspCode, Message}` codes so the gateway stops retrying once processed: `00` for
   * settled-or-recorded, `02` for an already confirmed order, `01`/`04`/`97`/`99` for
   * the failure modes. Settling itself still goes through `handleCallback`, so the
   * ledger stays idempotent no matter how often VNPay knocks.
   */
  async handleVnpayIpn(raw: Record<string, unknown>): Promise<{ RspCode: string; Message: string }> {
    if (!this.gateways.verifyCallbackSignature(PaymentProvider.VNPAY, raw)) {
      return { RspCode: VNPAY_RSP.CHECKSUM_FAILED, Message: 'Invalid checksum' };
    }
    const txnRef = typeof raw.vnp_TxnRef === 'string' && raw.vnp_TxnRef ? raw.vnp_TxnRef : undefined;
    if (!txnRef) return { RspCode: VNPAY_RSP.UNKNOWN_ERROR, Message: 'Missing order reference' };
    const found = await this.peekAttempt(PaymentProvider.VNPAY, txnRef);
    if (!found) return { RspCode: VNPAY_RSP.ORDER_NOT_FOUND, Message: 'Order not found' };
    if (found.payment.status === PaymentStatus.PAID) {
      return { RspCode: VNPAY_RSP.ALREADY_CONFIRMED, Message: 'Order already confirmed' };
    }
    try {
      const view = await this.handleCallback(PaymentProvider.VNPAY, raw);
      return view.status === TopUpStatus.PAID
        ? { RspCode: VNPAY_RSP.OK, Message: 'Confirm Success' }
        : { RspCode: VNPAY_RSP.OK, Message: 'Received and recorded' };
    } catch (error) {
      if (error instanceof NotFoundException) return { RspCode: VNPAY_RSP.ORDER_NOT_FOUND, Message: 'Order not found' };
      if (error instanceof UnprocessableEntityException) {
        const reason = (error.getResponse() as { details?: { reason?: string } })?.details?.reason;
        if (reason === TOPUP_REASON.AMOUNT_MISMATCH)
          return { RspCode: VNPAY_RSP.INVALID_AMOUNT, Message: 'Invalid amount' };
        if (reason === TOPUP_REASON.ALREADY_SETTLED)
          return { RspCode: VNPAY_RSP.ALREADY_CONFIRMED, Message: 'Order already confirmed' };
      }
      if (error instanceof BadRequestException) return { RspCode: VNPAY_RSP.UNKNOWN_ERROR, Message: 'Invalid request' };
      throw error;
    }
  }
}
