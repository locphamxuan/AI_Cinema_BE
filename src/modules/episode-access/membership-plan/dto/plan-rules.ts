/** A monthly cycle covers one calendar month: 28 to 31 days. */
export const MONTHLY_DAYS = { min: 28, max: 31 } as const;

/** Plan codes are keys, not names: letters, digits, `_` and `-`, no spaces or accents. */
export const PLAN_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Ceiling on one cycle's Coin price, so a typo cannot price a plan out of reach. */
export const MAX_PLAN_PRICE_COINS = 100_000;
