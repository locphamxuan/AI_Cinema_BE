import { Prisma } from '@prisma/client';

/** A rule finds Coin ledger rows since `since`; each hit becomes one OPEN flag (once per rule and row). */
export interface RiskRule {
  code: string;
  /** Shown to the Admin, in Vietnamese. */
  description: string;
  query: (since: Date) => Prisma.Sql;
}

/** One top-up worth this much or more is unusual for a viewer of short AI films. */
export const LARGE_TOP_UP_VND = 5_000_000;
/** A hand correction of this many VND or more deserves a second look. */
export const LARGE_ADJUSTMENT_VND = 1_000_000;
/** This many unlocks by one wallet inside the window looks scripted. */
export const RAPID_UNLOCK_COUNT = 15;
export const RAPID_UNLOCK_WINDOW_MINUTES = 10;
/** Refunds received by one wallet within 24 h. */
export const REPEATED_REFUND_COUNT = 5;

/** Each query answers `id` (the coin transaction) and `reason`. */
export const RISK_RULES: RiskRule[] = [
  {
    code: 'LARGE_TOP_UP',
    description: `Nạp từ ${LARGE_TOP_UP_VND.toLocaleString('vi-VN')} VND trở lên trong một lần`,
    query: (since) => Prisma.sql`
      SELECT ct.id, 'Nạp ' || (ct.main_amount::bigint * ct.rate_vnd) || ' VND trong một lần' AS reason
      FROM coin_transactions ct
      WHERE ct.entry_type = 'TOP_UP' AND ct.created_at >= ${since}
        AND ct.main_amount::bigint * ct.rate_vnd >= ${LARGE_TOP_UP_VND}`,
  },
  {
    code: 'LARGE_ADJUSTMENT',
    description: `Điều chỉnh Coin bằng tay từ ${LARGE_ADJUSTMENT_VND.toLocaleString('vi-VN')} VND trở lên`,
    query: (since) => Prisma.sql`
      SELECT ct.id, 'Điều chỉnh tay ' || ((ABS(ct.main_amount) + ABS(ct.bonus_amount))::bigint * ct.rate_vnd) || ' VND' AS reason
      FROM coin_transactions ct
      WHERE ct.entry_type = 'ADJUSTMENT' AND ct.created_at >= ${since}
        AND (ABS(ct.main_amount) + ABS(ct.bonus_amount))::bigint * ct.rate_vnd >= ${LARGE_ADJUSTMENT_VND}`,
  },
  {
    code: 'RAPID_UNLOCKS',
    description: `${RAPID_UNLOCK_COUNT} lượt mở khóa tập trở lên trong ${RAPID_UNLOCK_WINDOW_MINUTES} phút từ một ví`,
    query: (since) => Prisma.sql`
      SELECT id, burst || ' lượt mở khóa trong ${Prisma.raw(String(RAPID_UNLOCK_WINDOW_MINUTES))} phút' AS reason FROM (
        SELECT ct.id, COUNT(*) OVER (
          PARTITION BY ct.wallet_id ORDER BY ct.created_at
          RANGE BETWEEN INTERVAL '${Prisma.raw(String(RAPID_UNLOCK_WINDOW_MINUTES))} minutes' PRECEDING AND CURRENT ROW
        ) AS burst
        FROM coin_transactions ct
        WHERE ct.entry_type = 'EPISODE_PURCHASE' AND ct.created_at >= ${since}
      ) unlocks WHERE burst = ${RAPID_UNLOCK_COUNT}`,
  },
  {
    code: 'REPEATED_REFUNDS',
    description: `${REPEATED_REFUND_COUNT} lần hoàn Coin trở lên trong 24 giờ cho một ví`,
    query: (since) => Prisma.sql`
      SELECT id, burst || ' lần hoàn Coin trong 24 giờ' AS reason FROM (
        SELECT ct.id, COUNT(*) OVER (
          PARTITION BY ct.wallet_id ORDER BY ct.created_at RANGE BETWEEN INTERVAL '24 hours' PRECEDING AND CURRENT ROW
        ) AS burst
        FROM coin_transactions ct
        WHERE ct.entry_type = 'REFUND' AND ct.created_at >= ${since}
      ) refunds WHERE burst = ${REPEATED_REFUND_COUNT}`,
  },
];

export const RISK_RULE_CODES = RISK_RULES.map((rule) => rule.code);
