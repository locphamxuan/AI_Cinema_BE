import type { Prisma } from '@prisma/client';

/** The columns one order read needs; the gateway half arrives on the payment row. */
export const ORDER_VIEW = {
  id: true,
  amountVnd: true,
  coinsGranted: true,
  rateVnd: true,
  status: true,
  failureReason: true,
  expiresAt: true,
  createdAt: true,
  walletId: true,
  userId: true,
} satisfies Prisma.CoinTopUpSelect;

export type OrderRow = Prisma.CoinTopUpGetPayload<{ select: typeof ORDER_VIEW }>;

/** The columns one payment attempt read needs. */
export const PAYMENT_VIEW = {
  id: true,
  provider: true,
  providerTxnId: true,
  providerPaymentId: true,
  amountVnd: true,
  status: true,
  redirectUrl: true,
  failureReason: true,
  paidAt: true,
  expiresAt: true,
  createdAt: true,
  coinTopUpId: true,
} satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_VIEW }>;

/** An order row as the list reads it: order columns with the newest attempt attached. */
export type OrderWithPayments = OrderRow & { payments: PaymentRow[] };

/**
 * The flat order the member screens already know: gateway fields come from the newest attempt,
 * so the FE contract does not move while the tables split underneath.
 */
export const orderView = (order: OrderRow, payment: PaymentRow | null) => ({
  topUpId: order.id,
  provider: payment?.provider ?? null,
  providerTxnId: payment?.providerTxnId ?? null,
  amountVnd: order.amountVnd,
  coinsGranted: order.coinsGranted,
  rateVnd: order.rateVnd,
  status: order.status,
  redirectUrl: payment?.redirectUrl ?? null,
  providerPaymentId: payment?.providerPaymentId ?? null,
  failureReason: order.failureReason,
  paidAt: payment?.paidAt ?? null,
  expiresAt: order.expiresAt,
});
