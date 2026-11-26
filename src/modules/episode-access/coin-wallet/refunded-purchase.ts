import { CoinEntryType, CycleStatus, SubscriptionEndReason, SubscriptionStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { OPEN_STATUSES } from 'src/modules/episode-access/subscription/subscription-rules';

/**
 * What a Coin payment bought. Its price is the whole payment, main and bonus Coins together, so it
 * still says how much bonus left the wallet when a lot row of an old payment could not be linked.
 */
export type Purchase =
  | { kind: 'EPISODE'; id: string; priceCoins: number }
  | { kind: 'CYCLE'; id: string; priceCoins: number; periodEnd: Date; subscriptionId: string };

/** What taking a purchase back changed. */
export interface UndonePurchase {
  episodeAccessId: string | null;
  subscriptionCycleId: string | null;
  subscriptionEnded: boolean;
}

/** The episode unlock or the plan cycle a payment (its first row) paid for; null when none is linked. */
export async function purchaseOf(
  tx: PrismaTx,
  payment: { id: string; entryType: CoinEntryType },
): Promise<Purchase | null> {
  if (payment.entryType === CoinEntryType.EPISODE_PURCHASE) {
    const access = await tx.episodeAccess.findUnique({
      where: { coinTransactionId: payment.id },
      select: { id: true, paidCoins: true },
    });
    return access && { kind: 'EPISODE', id: access.id, priceCoins: access.paidCoins };
  }
  const cycle = await tx.subscriptionCycle.findUnique({
    where: { coinTransactionId: payment.id },
    select: { id: true, priceCoins: true, periodEnd: true, subscriptionId: true },
  });
  return cycle && { kind: 'CYCLE', ...cycle };
}

/**
 * Takes back what a refunded payment bought, so nobody keeps both the Coins and the content: the
 * episode unlock is revoked (the member may buy it again), and a plan cycle is marked REFUNDED, which
 * takes it out of plan revenue. When that cycle paid for time that has not run out, the plan ends now,
 * as an Admin cancellation would.
 */
export async function undoPurchase(
  tx: PrismaTx,
  purchase: Purchase | null,
  revokeReason: string,
  now: Date,
): Promise<UndonePurchase> {
  if (!purchase) return { episodeAccessId: null, subscriptionCycleId: null, subscriptionEnded: false };
  if (purchase.kind === 'EPISODE') {
    // An unlock already revoked (taken down meanwhile) keeps its first revoke time and reason.
    await tx.episodeAccess.updateMany({
      where: { id: purchase.id, revokedAt: null },
      data: { revokedAt: now, revokeReason },
    });
    return { episodeAccessId: purchase.id, subscriptionCycleId: null, subscriptionEnded: false };
  }
  await tx.subscriptionCycle.update({ where: { id: purchase.id }, data: { status: CycleStatus.REFUNDED } });
  const ended =
    purchase.periodEnd > now
      ? await tx.subscription.updateMany({
          where: { id: purchase.subscriptionId, status: { in: OPEN_STATUSES } },
          data: {
            status: SubscriptionStatus.CANCELLED,
            autoRenew: false,
            cancelledAt: now,
            endedAt: now,
            endReason: SubscriptionEndReason.CANCELLED_BY_ADMIN,
            nextRenewalAt: null,
          },
        })
      : { count: 0 };
  return { episodeAccessId: null, subscriptionCycleId: purchase.id, subscriptionEnded: ended.count > 0 };
}
