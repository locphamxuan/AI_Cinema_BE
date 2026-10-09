import { createHmac, timingSafeEqual } from 'node:crypto';

/** MoMo `extraData` carries our order id so the IPN can be cross-checked. */
export function encodeTopUpExtraData(topUpId: string): string {
  return Buffer.from(JSON.stringify({ topUpId })).toString('base64');
}

export function decodeTopUpExtraData(extraData: string | undefined): string | undefined {
  if (!extraData) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(extraData, 'base64').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'topUpId' in parsed) {
      const topUpId = (parsed as { topUpId?: unknown }).topUpId;
      return typeof topUpId === 'string' && topUpId ? topUpId : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface MomoCreateParams {
  accessKey: string;
  partnerCode: string;
  orderId: string;
  requestId: string;
  amountVnd: number;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  extraData: string;
  requestType: string;
}

/**
 * The exact field order MoMo signs for a create-order call. Any deviation (order,
 * separator, string form of the amount) breaks the signature.
 */
export function momoCreateRawSignature(params: MomoCreateParams): string {
  return (
    `accessKey=${params.accessKey}` +
    `&amount=${params.amountVnd}` +
    `&extraData=${params.extraData}` +
    `&ipnUrl=${params.ipnUrl}` +
    `&orderId=${params.orderId}` +
    `&orderInfo=${params.orderInfo}` +
    `&partnerCode=${params.partnerCode}` +
    `&redirectUrl=${params.redirectUrl}` +
    `&requestId=${params.requestId}` +
    `&requestType=${params.requestType}`
  );
}

export function hmacSha256Hex(secretKey: string, raw: string): string {
  return createHmac('sha256', secretKey).update(raw, 'utf8').digest('hex');
}

export function signMomoCreateRequest(params: MomoCreateParams, secretKey: string): string {
  return hmacSha256Hex(secretKey, momoCreateRawSignature(params));
}

/**
 * Verifies a MoMo IPN body. Amounts arrive as JSON numbers; their plain string form is
 * what MoMo signed, so `String(amount)` reproduces the raw signature exactly for integers.
 */
export function verifyMomoIpnSignature(body: Record<string, unknown>, accessKey: string, secretKey: string): boolean {
  const raw =
    `accessKey=${accessKey}` +
    `&amount=${stringifyIpnValue(body.amount)}` +
    `&extraData=${stringifyIpnValue(body.extraData)}` +
    `&message=${stringifyIpnValue(body.message)}` +
    `&orderId=${stringifyIpnValue(body.orderId)}` +
    `&orderInfo=${stringifyIpnValue(body.orderInfo)}` +
    `&orderType=${stringifyIpnValue(body.orderType)}` +
    `&partnerCode=${stringifyIpnValue(body.partnerCode)}` +
    `&payType=${stringifyIpnValue(body.payType)}` +
    `&requestId=${stringifyIpnValue(body.requestId)}` +
    `&responseTime=${stringifyIpnValue(body.responseTime)}` +
    `&resultCode=${stringifyIpnValue(body.resultCode)}` +
    `&transId=${stringifyIpnValue(body.transId)}`;
  return secureCompare(hmacSha256Hex(secretKey, raw), stringifyIpnValue(body.signature));
}

function stringifyIpnValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Constant-time comparison that never throws on length mismatch. */
export function secureCompare(expectedHex: string, actual: string | undefined): boolean {
  if (!actual || expectedHex.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(actual, 'utf8'));
}

export interface MomoStatusParams {
  accessKey: string;
  partnerCode: string;
  orderId: string;
  requestId: string;
}

/** Raw signature for MoMo's transaction-status query. */
export function momoStatusRawSignature(params: MomoStatusParams): string {
  return (
    `accessKey=${params.accessKey}` +
    `&orderId=${params.orderId}` +
    `&partnerCode=${params.partnerCode}` +
    `&requestId=${params.requestId}`
  );
}
