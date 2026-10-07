import { BadRequestException } from '@nestjs/common';
import { decodeTopUpExtraData } from '../gateways/momo-signing';
import { TOPUP_REASON } from '../constants/topup-reason';

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

export const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Guards Prisma `Uuid` filters: a malformed id must answer 404/400, never a 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_RE.test(value);

export const intOf = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
};

/**
 * Reads the documented JSON shape as well as the VNPay (`vnp_*`) and MoMo IPN fields into one
 * callback. A missing signature is refused outright; the HMAC check against the gateway secret
 * is the adapter's job when the real SDK lands, the signature and the raw payload are kept for it.
 */
export function normalizeCallback(raw: Record<string, unknown>): GatewayCallback {
  const body = raw;
  // A failed VNPay payment may carry no transaction number at all; the order ref plus
  // the gateway verdict still identifies the delivery exactly once.
  const vnpFallback =
    textOf(body.vnp_TxnRef) && textOf(body.vnp_ResponseCode)
      ? `${textOf(body.vnp_TxnRef)}:${textOf(body.vnp_ResponseCode)}`
      : undefined;
  const eventId =
    textOf(body.eventId) ??
    textOf(body.vnp_TransactionNo) ??
    vnpFallback ??
    textOf(body.transId) ??
    textOf(body.transactionId);
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
  // VNPay only calls a payment done when BOTH codes read '00'.
  const vnpStatus =
    body.vnp_ResponseCode !== undefined
      ? body.vnp_ResponseCode === '00' &&
        (body.vnp_TransactionStatus === undefined || body.vnp_TransactionStatus === '00')
        ? 'success'
        : 'failed'
      : undefined;
  const status: GatewayCallback['status'] | undefined =
    rawStatus === 'success' || rawStatus === 'failed' || rawStatus === 'cancelled'
      ? rawStatus
      : (vnpStatus ??
        (body.resultCode !== undefined ? (Number(body.resultCode) === 0 ? 'success' : 'failed') : undefined));
  if (!eventId || amountVnd === undefined || status === undefined) {
    throw new BadRequestException({
      message: 'The callback is missing its event id, amount or status',
      details: { reason: TOPUP_REASON.INVALID_CALLBACK },
    });
  }
  const paidAt = textOf(body.paidAt) ? new Date(textOf(body.paidAt) as string) : undefined;
  return {
    eventId,
    topUpId: textOf(body.topUpId) ?? decodeTopUpExtraData(textOf(body.extraData)),
    providerTxnId: textOf(body.providerTxnId) ?? textOf(body.vnp_TxnRef) ?? textOf(body.orderId),
    amountVnd,
    status,
    providerPaymentId: textOf(body.providerPaymentId) ?? textOf(body.vnp_TransactionNo) ?? textOf(body.transId),
    signature,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined,
  };
}
