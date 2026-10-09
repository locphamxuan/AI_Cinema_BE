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

/** What a caller wants to add. Bonus Coins always land in a lot so their expiry stays known. */
export interface CreditRequest {
  entryType: CoinEntryType;
  mainAmount?: number;
  bonusAmount?: number;
  lotSource: CoinLotSource;
  /** Days the new lot stays usable; the platform setting when omitted. */
  expiresInDays?: number;
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

/** A manual correction; either part may be negative, but a bonus debit never creates Coins. */
export interface AdjustmentRequest {
  mainAmount?: number;
  bonusAmount?: number;
  reason: string;
  rateVnd?: number;
  idempotencyKey?: string;
  createdById?: string;
}

/** What one write to a wallet did. */
export interface CoinMovement {
  transactionId: string;
  mainCoins: number;
  bonusCoins: number;
  mainBalance: number;
  bonusBalance: number;
}

/** Reasons travel in `error.details.reason`: error.code already carries the HTTP status. */
export const COIN_REASON = {
  INSUFFICIENT_COINS: 'INSUFFICIENT_COINS',
  NOTHING_TO_ADJUST: 'NOTHING_TO_ADJUST',
  SPLIT_THE_CORRECTION: 'SPLIT_THE_CORRECTION',
} as const;
