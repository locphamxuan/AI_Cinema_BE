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

/**
 * The two plan fields playback needs: `code` names the plan in responses, `features` carries
 * `maxConcurrentStreams`/`adFree`/`maxQuality`. P4-5 reads this once per request and passes it down, so verify, the
 * device check and ad scheduling never each re-read the same subscription.
 */
export interface RunningPlanSnapshot {
  code: string;
  features: Prisma.JsonValue | null;
}

/** One select for every reader of a RunningPlanSnapshot. */
export const RUNNING_PLAN_SELECT = {
  plan: { select: { code: true, features: true } },
} satisfies Prisma.SubscriptionSelect;
