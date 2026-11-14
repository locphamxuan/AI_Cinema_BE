import { Injectable } from '@nestjs/common';
import { PlanPeriod, SubscriptionEndReason, SubscriptionSource, SubscriptionStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';

const DAY_MS = 86_400_000;

/** The plan a gift of days applies to when the member has none: the cheapest monthly plan on sale. */
export interface GiftPlan {
  planId: string;
  priceCoins: number;
}

export interface PlanDaysGranted {
  subscriptionId: string;
  /** True when the days were added to a plan the member already had. */
  extended: boolean;
  currentPeriodEnd: Date;
  /** BR-49: the days valued at days x monthly price / 30, a promotion cost. */
  promoValueCoins: number;
}

/**
 * BR-09: days of the monthly plan given by a reward. A member with an open plan gets the days
 * added to its period (a plan waiting on a failed renewal is running again until the new end);
 * a member without one gets a monthly plan of that many days that does not auto-renew.
 */
@Injectable()
export class PlanDaysGrantService {
  constructor(private readonly settings: PlatformSettingService) {}

  /** The plan a new gift would start, or null when no monthly plan is on sale. */
  async giftPlan(tx: PrismaTx, at = new Date()): Promise<GiftPlan | null> {
    const price = await tx.membershipPlanPrice.findFirst({
      where: {
        effectiveFrom: { lte: at },
        effectiveTo: null,
        plan: { isActive: true, isFree: false, period: PlanPeriod.MONTHLY },
      },
      orderBy: { priceCoins: 'asc' },
      select: { planId: true, priceCoins: true },
    });
    return price ? { planId: price.planId, priceCoins: price.priceCoins } : null;
  }

  /** The member's plan that days would be added to: ACTIVE or waiting on a renewal retry. */
  openPlan(tx: PrismaTx, userId: string) {
    return tx.subscription.findFirst({
      where: { userId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      orderBy: { currentPeriodEnd: 'desc' },
    });
  }

  async grant(tx: PrismaTx, userId: string, days: number, now = new Date()): Promise<PlanDaysGranted | null> {
    const { subscriptionCancelWindowHours } = await this.settings.get();
    const windowEnd = (end: Date) => new Date(end.getTime() - subscriptionCancelWindowHours * 3_600_000);
    const open = await this.openPlan(tx, userId);

    if (open) {
      const from = open.currentPeriodEnd.getTime() > now.getTime() ? open.currentPeriodEnd : now;
      const end = new Date(from.getTime() + days * DAY_MS);
      const updated = await tx.subscription.update({
        where: { id: open.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: end,
          nextRenewalAt: open.autoRenew ? end : null,
          cancelWindowEndsAt: open.autoRenew ? windowEnd(end) : open.cancelWindowEndsAt,
        },
      });
      return {
        subscriptionId: updated.id,
        extended: true,
        currentPeriodEnd: end,
        promoValueCoins: promoValue(days, open.priceCoins),
      };
    }

    const plan = await this.giftPlan(tx, now);
    if (!plan) return null;
    // A quote never paid for would block the member from the plan they are being given.
    await tx.subscription.updateMany({
      where: { userId, status: SubscriptionStatus.PENDING },
      data: {
        status: SubscriptionStatus.CANCELLED,
        endedAt: now,
        endReason: SubscriptionEndReason.CANCELLED_BY_MEMBER,
      },
    });
    const end = new Date(now.getTime() + days * DAY_MS);
    const created = await tx.subscription.create({
      data: {
        userId,
        planId: plan.planId,
        status: SubscriptionStatus.ACTIVE,
        source: SubscriptionSource.REWARD,
        autoRenew: false,
        priceCoins: plan.priceCoins,
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        nextRenewalAt: null,
      },
    });
    return {
      subscriptionId: created.id,
      extended: false,
      currentPeriodEnd: end,
      promoValueCoins: promoValue(days, plan.priceCoins),
    };
  }
}

const promoValue = (days: number, monthlyPriceCoins: number) => Math.round((days * monthlyPriceCoins) / 30);
