import type { CoinEntryType, CoinLotSource, CoinReferenceType } from '@prisma/client';

/** How much of a payment came out of main Coins and how much out of bonus Coins. */
export interface CoinSplit {
  mainCoins: number;
  bonusCoins: number;
}

/** What a caller wants to move out of a wallet; the service decides main first, bonus after. */
export interface SpendRequest {
  entryType: CoinEntryType;
  /** Coins to take out, main Coins first. */
  amountCoins: number;
  /** VND value of one main Coin when the entry is written; the current rate when omitted. */
  coinRateVnd?: number;
  referenceType?: CoinReferenceType;
  referenceId?: string;
  /** Replaying a request with the same key moves the wallet once. */
  idempotencyKey?: string;
  description?: string;
}

/** What a caller wants to add. Bonus Coins always land in a lot so their source stays known. */
export interface CreditRequest {
  entryType: CoinEntryType;
  mainAmount?: number;
  bonusAmount?: number;
  lotSource: CoinLotSource;
  /** Set when the caller created the lot itself. */
  lotId?: string;
  rateVnd?: number;
  referenceType?: CoinReferenceType;
  referenceId?: string;
  idempotencyKey?: string;
  description?: string;
  createdById?: string;
  reversesId?: string;
}

/** What one write to a wallet did. */
export interface CoinMovement {
  transactionId: string;
  mainCoins: number;
  bonusCoins: number;
  mainBalance: number;
  bonusBalance: number;
  /** True when a retried request found its earlier move and nothing was written. */
  replayed?: boolean;
}

/** Reasons travel in `error.details.reason`: error.code already carries the HTTP status. */
export const COIN_REASON = {
  INSUFFICIENT_COINS: 'INSUFFICIENT_COINS',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  NOT_REFUNDABLE: 'NOT_REFUNDABLE',
  ALREADY_REFUNDED: 'ALREADY_REFUNDED',
  PAYMENT_NOT_LINKED: 'PAYMENT_NOT_LINKED',
  TRANSACTION_NOT_FOUND: 'COIN_TRANSACTION_NOT_FOUND',
} as const;

/** What asks for a payment to be paid back. */
export interface RefundRequest {
  /** Written on the ledger row, e.g. why the content was taken down. */
  description: string;
  /** Kept on the EpisodeAccess the refund revokes. */
  revokeReason: string;
  /** The staff account that asked; empty for a system refund. */
  createdById?: string;
}

/** What a refund did, or found already done. */
export interface PaymentRefund {
  /** The first row of the payment, which every row of it points at. */
  paymentId: string;
  entryType: CoinEntryType;
  walletId: string;
  /** The REFUND entry: the one just written, or the earlier one when the payment was already refunded. */
  refundTransactionId: string;
  /** True when the payment had been refunded before and nothing moved now. */
  alreadyRefunded: boolean;
  mainCoins: number;
  bonusCoins: number;
  /** Balances right after the refund; null when nothing moved now. */
  mainBalance: number | null;
  bonusBalance: number | null;
  /** The episode unlock the refund revoked, if the payment bought one. */
  episodeAccessId: string | null;
  /** The plan cycle the refund marked REFUNDED, and whether its subscription was ended by it. */
  subscriptionCycleId: string | null;
  subscriptionEnded: boolean;
}
