import { ConflictException } from '@nestjs/common';
import { SupportStatus } from '@prisma/client';

/**
 * The state machine of the plan (§7):
 *
 * ```
 * AI_HANDLING ──member confirms──▶ CLOSED (AI_RESOLVED)
 * AI_HANDLING ──escalate─────────▶ WAITING_FOR_STAFF ──claim/reply──▶ STAFF_HANDLING
 * STAFF_HANDLING ──staff resolve─▶ RESOLVED ──staff close──▶ CLOSED (STAFF_RESOLVED)
 * AI_HANDLING / WAITING_FOR_STAFF ──member closes──▶ CLOSED (MEMBER_CLOSED)
 * AI_HANDLING ──AI resolved + inactivity──▶ CLOSED (INACTIVITY)
 * ```
 */
export const SUPPORT_STATUS_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  [SupportStatus.AI_HANDLING]: [SupportStatus.WAITING_FOR_STAFF, SupportStatus.CLOSED],
  [SupportStatus.WAITING_FOR_STAFF]: [SupportStatus.STAFF_HANDLING, SupportStatus.RESOLVED, SupportStatus.CLOSED],
  [SupportStatus.STAFF_HANDLING]: [SupportStatus.WAITING_FOR_STAFF, SupportStatus.RESOLVED, SupportStatus.CLOSED],
  [SupportStatus.RESOLVED]: [SupportStatus.CLOSED],
  [SupportStatus.CLOSED]: [],
};

/** Any case the member or Staff can still act on; used by queue and ownership queries. */
export const OPEN_SUPPORT_STATUSES: readonly SupportStatus[] = [
  SupportStatus.AI_HANDLING,
  SupportStatus.WAITING_FOR_STAFF,
  SupportStatus.STAFF_HANDLING,
  SupportStatus.RESOLVED,
];

/** The quick replies the member app renders under an AI answer (plan §5.3). */
export const SUPPORT_QUICK_REPLY = {
  CONFIRM_RESOLVED: 'CONFIRM_RESOLVED',
  REQUEST_STAFF: 'REQUEST_STAFF',
} as const;

export type SupportQuickReply = (typeof SUPPORT_QUICK_REPLY)[keyof typeof SUPPORT_QUICK_REPLY];

/** Throws a 409 when the lifecycle forbids the move, so a race never overwrites a closed case. */
export function assertStatusTransition(from: SupportStatus, to: SupportStatus): void {
  if (!SUPPORT_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`Support case cannot move from ${from} to ${to}`);
  }
}
