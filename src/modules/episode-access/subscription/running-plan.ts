import { Prisma, SubscriptionStatus } from '@prisma/client';

/**
 * The member's plan that grants access right now: ACTIVE or PAST_DUE, and only up to the end of
 * the period it paid for (BR-11). The status alone is not enough: the sweeper ends a plan a little
 * after its period, and a PAST_DUE plan is only waiting on a retry.
 */
export const runningPlanWhere = (userId: string, now = new Date()): Prisma.SubscriptionWhereInput => ({
  userId,
  status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
  currentPeriodEnd: { gt: now },
});
