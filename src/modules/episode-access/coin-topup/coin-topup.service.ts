import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CoinReferenceType, PaymentProvider, Prisma, TopUpStatus } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';

/** How long a pending order may sit before the sweeper gives up on it. */
const ORDER_TTL_MINUTES = 15;

/** Reasons of this module travel in `error.details.reason`. */
export const TOPUP_REASON = {
  AMOUNT_OUT_OF_RANGE: 'TOPUP_AMOUNT_OUT_OF_RANGE',
  ALREADY_SETTLED: 'TOPUP_ALREADY_SETTLED',
  NOT_PAYABLE: 'TOPUP_NOT_PAYABLE',
  AMOUNT_MISMATCH: 'TOPUP_AMOUNT_MISMATCH',
  NOT_FOUND: 'TOPUP_NOT_FOUND',
  INVALID_CALLBACK: 'CALLBACK_INVALID',
  MISSING_SIGNATURE: 'CALLBACK_MISSING_SIGNATURE',
} as const;

/** A gateway delivery normalised from VNPay, MoMo or the documented JSON shape. */
export interface GatewayCallback {
  eventId: string;
  topUpId?: string;
  providerTxnId?: string;
  amountVnd: number;
  status: 'success' | 'failed' | 'cancelled';
  providerPaymentId?: string;
  signature: string;
  paidAt?: Date;
}

/**
 * Step 12: Coins bought with a gateway. The order row is written before the member is sent to the
 * gateway and the ledger entry only when the gateway confirms, so the amount agreed on and the
 * amount credited cannot drift. Top-ups credit main Coins: bonus Coins only come from a promotion
 * an Admin sets up on purpose, so they always expire.
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

  /** Creates the order and hands back where to send the member. The gateway itself is out of scope. */
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
    // Unique per provider, so a replayed callback finds its order and cannot credit twice.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    const providerTxnId = `${provider}-${stamp}`;
    return this.prisma.coinTopUp
      .create({
        data: {
          userId,
          walletId: wallet.id,
          provider,
          providerTxnId,
          amountVnd,
          coinsGranted,
          rateVnd: coinRateVnd,
          redirectUrl: redirectOf(provider, providerTxnId, amountVnd),
          expiresAt: new Date(Date.now() + ORDER_TTL_MINUTES * 60_000),
        },
        select: ORDER_VIEW,
      })
      .then(viewOf);
  }

  listMine(userId: string, query: PaginateQuery) {
    return paginate(query, this.prisma.coinTopUp, {
      where: { userId },
      select: Object.keys(ORDER_VIEW) as (keyof OrderRow)[],
      sortableColumns: ['createdAt', 'amountVnd', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'], provider: ['$eq'] },
    }).then((page) => ({ ...page, data: (page.data as OrderRow[]).map(viewOf) }));
  }

  async findMine(userId: string, topUpId: string) {
    const topUp = await this.prisma.coinTopUp.findFirst({ where: { id: topUpId, userId }, select: ORDER_VIEW });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    return viewOf(topUp);
  }

  /**
   * Settles an order the gateway confirmed. Called at most once per order: a second call finds
   * the order already PAID and reports TOPUP_ALREADY_SETTLED instead of crediting again.
   */
  async settle(input: {
    topUpId: string;
    providerPaymentId: string;
    amountVnd: number;
    idempotencyKey: string;
    paidAt?: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const topUp = await tx.coinTopUp.findUniqueOrThrow({
        where: { id: input.topUpId },
        select: ORDER_VIEW,
      });
      if (topUp.status === TopUpStatus.PAID) {
        throw new UnprocessableEntityException({
          message: 'The order has already been paid',
          details: { reason: TOPUP_REASON.ALREADY_SETTLED, topUpId: topUp.id },
        });
      }
      if (topUp.status !== TopUpStatus.PENDING) {
        throw new UnprocessableEntityException({
          message: 'The order is no longer payable',
          details: { reason: TOPUP_REASON.NOT_PAYABLE, status: topUp.status, topUpId: topUp.id },
        });
      }
      if (input.amountVnd !== topUp.amountVnd) {
        await tx.coinTopUp.update({
          where: { id: topUp.id },
          data: {
            status: TopUpStatus.FAILED,
            failureReason: `The gateway reported ${input.amountVnd} VND instead of ${topUp.amountVnd} VND`,
          },
        });
        throw new UnprocessableEntityException({
          message: 'The settled amount does not match the order',
          details: { reason: TOPUP_REASON.AMOUNT_MISMATCH, expectedVnd: topUp.amountVnd, settledVnd: input.amountVnd },
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
          description: `Top-up ${topUp.provider}`,
        },
        input.paidAt,
      );
      const settled = await tx.coinTopUp.update({
        where: { id: topUp.id },
        data: {
          status: TopUpStatus.PAID,
          providerPaymentId: input.providerPaymentId,
          coinTransactionId: movement.transactionId,
          paidAt: input.paidAt ?? new Date(),
        },
        select: ORDER_VIEW,
      });
      await this.notifications.notify(
        [topUp.userId],
        {
          type: NOTIFICATION_TYPE.COIN_TOPUP_SUCCESS,
          title: `Đã nạp ${topUp.coinsGranted} Coin`,
          body: `Thanh toán ${topUp.amountVnd.toLocaleString('vi-VN')} VND qua ${topUp.provider} đã thành công.`,
          link: '/wallet',
          payload: { topUpId: topUp.id, coinsGranted: topUp.coinsGranted },
        },
        tx,
      );
      return viewOf(settled);
    });
  }

  /** The gateway reports the member gave up, or gave the wrong amount. */
  markFailed(topUpId: string, reason: string, status: Extract<TopUpStatus, 'FAILED' | 'CANCELLED'>) {
    return this.prisma.coinTopUp.update({ where: { id: topUpId }, data: { status, failureReason: reason } });
  }

  /**
   * A gateway webhook delivery. Idempotent on (provider, event_id): a repeated delivery answers
   * with the same order and never credits twice. A delivery for an order already PAID answers the
   * order as well, so the gateway may retry freely.
   */
  async handleCallback(provider: PaymentProvider, raw: Record<string, unknown>) {
    const callback = normalizeCallback(raw);
    const replayed = await this.prisma.paymentCallback.findUnique({
      where: { provider_eventId: { provider, eventId: callback.eventId } },
      select: { topUpId: true, handledAt: true },
    });
    if (replayed?.handledAt) return this.topUpView(replayed.topUpId);
    const topUp = await this.resolveTopUp(provider, callback);
    if (!replayed) {
      try {
        await this.prisma.paymentCallback.create({
          data: {
            topUpId: topUp.id,
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
    if (topUp.status === TopUpStatus.PAID) {
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (topUp.status !== TopUpStatus.PENDING) {
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (callback.status !== 'success') {
      await this.markFailed(
        topUp.id,
        `The gateway reported the payment as ${callback.status}`,
        callback.status === 'cancelled' ? TopUpStatus.CANCELLED : TopUpStatus.FAILED,
      );
      await handled({ handledAt: new Date() });
      return this.topUpView(topUp.id);
    }
    if (callback.amountVnd !== topUp.amountVnd) {
      const failureReason = `The gateway reported ${callback.amountVnd} VND instead of ${topUp.amountVnd} VND`;
      await this.prisma.coinTopUp.update({
        where: { id: topUp.id },
        data: { status: TopUpStatus.FAILED, failureReason },
      });
      await handled({ handledAt: new Date(), errorMessage: failureReason });
      throw new UnprocessableEntityException({
        message: 'The settled amount does not match the order',
        details: { reason: TOPUP_REASON.AMOUNT_MISMATCH, expectedVnd: topUp.amountVnd, settledVnd: callback.amountVnd },
      });
    }
    try {
      const settled = await this.settle({
        topUpId: topUp.id,
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
      const topUp = await this.prisma.coinTopUp.findFirst({ where: { id: ref.topUpId, provider }, select: ORDER_VIEW });
      if (!topUp)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      return viewOf(topUp);
    }
    if (ref.providerTxnId) {
      const topUp = await this.prisma.coinTopUp.findFirst({
        where: { provider, providerTxnId: ref.providerTxnId },
        select: ORDER_VIEW,
      });
      if (!topUp)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      return viewOf(topUp);
    }
    throw new BadRequestException({
      message: 'The return trip needs a topUpId or a providerTxnId',
      details: { reason: TOPUP_REASON.INVALID_CALLBACK },
    });
  }

  /** The order a callback points at, by top-up id or by the gateway order id. */
  private async resolveTopUp(provider: PaymentProvider, callback: GatewayCallback) {
    if (callback.topUpId && isUuid(callback.topUpId)) {
      const topUp = await this.prisma.coinTopUp.findFirst({
        where: { id: callback.topUpId, provider },
        select: ORDER_VIEW,
      });
      if (topUp) return topUp;
    }
    if (callback.providerTxnId) {
      const topUp = await this.prisma.coinTopUp.findFirst({
        where: { provider, providerTxnId: callback.providerTxnId },
        select: ORDER_VIEW,
      });
      if (topUp) return topUp;
    }
    throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
  }

  private async topUpView(topUpId: string | null | undefined) {
    if (!topUpId)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: topUpId }, select: ORDER_VIEW });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    return viewOf(topUp);
  }
}

/**
 * The columns one order read needs. `walletId` and `userId` stay in the row for `settle` (credit
 * and notify) but never leave the server: `viewOf` strips them along with the raw primary key.
 */
const ORDER_VIEW = {
  id: true,
  provider: true,
  providerTxnId: true,
  amountVnd: true,
  coinsGranted: true,
  rateVnd: true,
  status: true,
  redirectUrl: true,
  providerPaymentId: true,
  failureReason: true,
  paidAt: true,
  expiresAt: true,
  createdAt: true,
  walletId: true,
  userId: true,
} satisfies Prisma.CoinTopUpSelect;

type OrderRow = Prisma.CoinTopUpGetPayload<{ select: typeof ORDER_VIEW }>;

/** The member sees `topUpId`, not the raw primary key, and never a gateway payload. */
const viewOf = ({ id, walletId: _walletId, userId: _userId, ...rest }: OrderRow) => ({ topUpId: id, ...rest });

/**
 * Where the member pays. A placeholder the gateway adapter replaces with the signed payment URL;
 * it carries the gateway order id so the callback finds its order either way.
 */
function redirectOf(provider: PaymentProvider, providerTxnId: string, amountVnd: number): string {
  const order = encodeURIComponent(providerTxnId);
  if (provider === PaymentProvider.MOMO) {
    return `https://test-payment.momo.vn/v2/gateway/pay?orderId=${order}&amount=${amountVnd}`;
  }
  return `https://sandbox.vnpayment.vn/tryitnow/Home/CreateOrder?orderId=${order}&amount=${amountVnd}`;
}

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Guards Prisma `Uuid` filters: a malformed id must answer 404/400, never a 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID_RE.test(value);

const intOf = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
};

/**
 * Reads the documented JSON shape as well as the VNPay (`vnp_*`) and MoMo IPN fields into one
 * callback. A missing signature is refused outright; the HMAC check against the gateway secret
 * is the adapter's job when the real SDK lands, the signature and the raw payload are kept for it.
 */
function normalizeCallback(raw: Record<string, unknown>): GatewayCallback {
  const body = raw;
  const eventId =
    textOf(body.eventId) ?? textOf(body.vnp_TransactionNo) ?? textOf(body.transId) ?? textOf(body.transactionId);
  const signature = textOf(body.signature) ?? textOf(body.vnp_SecureHash) ?? textOf(body.mac);
  if (!signature) {
    throw new BadRequestException({
      message: 'The callback carries no signature',
      details: { reason: TOPUP_REASON.MISSING_SIGNATURE },
    });
  }
  // VNPay sends the amount times 100; the documented shape and MoMo send it as-is.
  const vnpAmount = intOf(body.vnp_Amount);
  const amountVnd =
    intOf(body.amountVnd) ?? (vnpAmount !== undefined ? Math.floor(vnpAmount / 100) : undefined) ?? intOf(body.amount);
  const rawStatus = textOf(body.status)?.toLowerCase();
  const status: GatewayCallback['status'] | undefined =
    rawStatus === 'success' || rawStatus === 'failed' || rawStatus === 'cancelled'
      ? rawStatus
      : body.vnp_ResponseCode !== undefined
        ? body.vnp_ResponseCode === '00'
          ? 'success'
          : 'failed'
        : body.resultCode !== undefined
          ? Number(body.resultCode) === 0
            ? 'success'
            : 'failed'
          : undefined;
  if (!eventId || amountVnd === undefined || status === undefined) {
    throw new BadRequestException({
      message: 'The callback is missing its event id, amount or status',
      details: { reason: TOPUP_REASON.INVALID_CALLBACK },
    });
  }
  const paidAt = textOf(body.paidAt) ? new Date(textOf(body.paidAt) as string) : undefined;
  return {
    eventId,
    topUpId: textOf(body.topUpId),
    providerTxnId: textOf(body.providerTxnId) ?? textOf(body.vnp_TxnRef) ?? textOf(body.orderId),
    amountVnd,
    status,
    providerPaymentId: textOf(body.providerPaymentId) ?? textOf(body.vnp_TransactionNo) ?? textOf(body.transId),
    signature,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined,
  };
}
