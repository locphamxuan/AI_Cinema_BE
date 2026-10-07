import { createHmac } from 'node:crypto';
import { secureCompare } from './momo-signing';

/** VNPay response codes for the IPN answer (`RspCode`). */
export const VNPAY_RSP = {
  OK: '00',
  ORDER_NOT_FOUND: '01',
  ALREADY_CONFIRMED: '02',
  INVALID_AMOUNT: '04',
  CHECKSUM_FAILED: '97',
  UNKNOWN_ERROR: '99',
} as const;

export interface VnpayIpnAnswer {
  RspCode: string;
  Message: string;
}

/** `yyyyMMddHHmmss` in Vietnam time — the only clock VNPay speaks. */
export function formatVnpDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

/** Parses back a `yyyyMMddHHmmss` Vietnam-time stamp; undefined when malformed. */
export function parseVnpDateTime(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  // Vietnam has no daylight saving: UTC+7 all year round.
  const at = new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second));
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** HMAC-SHA512 over `key=value` pairs joined by `&`, keys sorted A–Z. */
export function signVnpayParams(params: Record<string, string>, secret: string): string {
  const data = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHmac('sha512', secret).update(data, 'utf8').digest('hex');
}

export function buildVnpayPayUrl(payUrl: string, params: Record<string, string>, secret: string): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) sorted[key] = params[key];
  const query = Object.entries(sorted)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return `${payUrl}?${query}&vnp_SecureHash=${signVnpayParams(params, secret)}`;
}

/**
 * Verifies a VNPay return/IPN query. Drops only the hash fields; empty values stay in
 * the checksum exactly as received, mirroring VNPay's own sample. Multi-valued keys
 * are refused outright: anything ambiguous must never settle money.
 */
export function verifyVnpaySignature(query: Record<string, unknown>, secret: string): boolean {
  const received = query.vnp_SecureHash;
  if (typeof received !== 'string' || !/^[0-9a-f]{128}$/i.test(received)) return false;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) return false;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false;
    params[key] = String(value);
  }
  return secureCompare(signVnpayParams(params, secret), received);
}

export interface VnpayQuerydrParams {
  tmnCode: string;
  providerTxnId: string;
  transactionDate: Date;
  createDate: Date;
  ipAddr: string;
  orderInfo: string;
}

/**
 * The pipe-joined payload VNPay's querydr API signs:
 * requestId|version|command|tmnCode|txnRef|transactionDate|createDate|ipAddr|orderInfo.
 */
export function vnpayQuerydrRawSignature(params: VnpayQuerydrParams & { requestId: string }): string {
  return [
    params.requestId,
    '2.1.0',
    'querydr',
    params.tmnCode,
    params.providerTxnId,
    formatVnpDateTime(params.transactionDate),
    formatVnpDateTime(params.createDate),
    params.ipAddr,
    params.orderInfo,
  ].join('|');
}

export function signVnpayQuerydr(params: VnpayQuerydrParams & { requestId: string }, secret: string): string {
  return createHmac('sha512', secret).update(vnpayQuerydrRawSignature(params), 'utf8').digest('hex');
}
