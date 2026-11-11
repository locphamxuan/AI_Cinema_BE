import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus, type MembershipPlan, type Subscription } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';

export const SUB_REASON = {
  EXISTS: 'SUBSCRIPTION_EXISTS',
  NOT_PENDING: 'SUBSCRIPTION_NOT_PENDING',
  WINDOW_CLOSED: 'CANCELLATION_WINDOW_CLOSED',
  NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  ENDED: 'SUBSCRIPTION_ENDED',
  NOT_ACTIVE: 'SUBSCRIPTION_NOT_ACTIVE',
} as const;

/** A paid plan whose renewal can still be switched on or off. */
const RUNNING: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

/** The last moment a cancellation is still accepted: the renewal date minus the window. */
export const windowEndOf = (renewalAt: Date, hours: number) => new Date(renewalAt.getTime() - hours * 3_600_000);

export function subscriptionNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Subscription not found', details: { reason: SUB_REASON.NOT_FOUND } });
}

/** Only the owner may read or change a subscription; a wrong id is a 404, not a 403. */
export async function findOwnSubscription(prisma: PrismaService, userId: string, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
  if (!subscription) throw subscriptionNotFound();
  return subscription;
}

/** Renewal settings belong to a paid plan; an unpaid intent or an ended plan has none to change. */
export function assertRunning(subscription: Subscription): void {
  if (!RUNNING.includes(subscription.status)) {
    throw new ConflictException({
      message: 'Only a running plan has a renewal to change',
      details: { reason: SUB_REASON.NOT_ACTIVE, status: subscription.status },
    });
  }
}

export const planOf = (plan: MembershipPlan) => ({
  id: plan.id,
  code: plan.code,
  name: plan.name,
  period: plan.period,
  durationDays: plan.durationDays,
});
