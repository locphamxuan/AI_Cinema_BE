import { StudioMilestoneStatus } from '@prisma/client';

/** What a hand-off holds of the budget. */
export interface CommittedHandoff {
  milestoneStatus: StudioMilestoneStatus;
  offeredFeeVnd: bigint | number;
  forfeitedVnd: bigint | number;
}

/** A project's production cost in VND (BR-46). */
export interface CostSummary {
  /** Sum of the cost entries: the budget, what the Admin granted on top, and corrections. */
  budgetVnd: number;
  /** The fee of every live hand-off, plus what replaced studios kept. */
  committedVnd: number;
  /** What a new or raised fee may still use; never below 0. */
  remainingVnd: number;
}

/**
 * A live hand-off holds its whole offered fee. A replaced one (SUPERSEDED) keeps only what was forfeited to
 * its studio; the rest of its fee returns to the budget (BR-59).
 */
export function committedOf(handoff: CommittedHandoff): number {
  return handoff.milestoneStatus === StudioMilestoneStatus.SUPERSEDED
    ? Number(handoff.forfeitedVnd)
    : Number(handoff.offeredFeeVnd);
}

export function summariseCost(budgetVnd: number, handoffs: CommittedHandoff[]): CostSummary {
  const committedVnd = handoffs.reduce((sum, handoff) => sum + committedOf(handoff), 0);
  return { budgetVnd, committedVnd, remainingVnd: Math.max(0, budgetVnd - committedVnd) };
}
