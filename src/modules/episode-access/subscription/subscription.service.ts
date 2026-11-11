import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CoinEntryType,
  CoinReferenceType,
  CycleStatus,
  SubscriptionEndReason,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';
import { PLAN_REASON, purchasablePlan } from '../membership-plan/membership-plan.service';
import { findOwnSubscription, planOf, SUB_REASON, windowEndOf } from './subscription-rules';

const DAY_MS = 86_400_000;

/** A subscription counts as open while it grants or may still grant access. */
const OPEN: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.PENDING];

const notPending = (status: SubscriptionStatus) =>
  new ConflictException({
    message: 'Only a pending subscription can be activated',
    details: { reason: SUB_REASON.NOT_PENDING, status },
  });

/**
 * Steps 9, 10 and 16 from the member's side: quoting a plan, paying for it and starting the
 * period. Joining is split in two on purpose: `subscribe` only quotes the price into a PENDING
 * intent (step 10, no Coin moves), `activate` takes the Coins and starts the period (step 16:
 * steps 11 and 14 are the balance check inside it). Stopping auto-renew lives in
 * SubscriptionAutoRenewService, the renewal the sweeper runs in SubscriptionRenewalService.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Step 10: quotes the first cycle into a PENDING intent without moving any Coin, so the UI can
   * show the price, the balances and the confirmation screen. A member who already has an open
   * plan (PENDING included) is told so with SUBSCRIPTION_EXISTS rather than opening a second one.
   * No idempotency key is needed: no Coin moves here, replaying the intent is `GET /subscriptions/me`
   * and paying for it is `activate`.
   */
  async subscribe(userId: string, planId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { plan, price } = await purchasablePlan(tx, planId);
      const now = new Date();
      // An intent never paid for is only a quote: a new quote replaces it instead of locking the
      // member out of every plan for good.
      await tx.subscription.updateMany({
        where: { userId, status: SubscriptionStatus.PENDING },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endedAt: now,
          endReason: SubscriptionEndReason.CANCELLED_BY_MEMBER,
        },
      });
      await this.assertNoOpenPlan(tx, userId);
      const periodEnd = new Date(now.getTime() + plan.durationDays * DAY_MS);
      const { subscriptionCancelWindowHours } = await this.settings.get();
      const cancelDeadline = windowEndOf(periodEnd, subscriptionCancelWindowHours);
      const quote = await this.wallets.affordability(userId, price.priceCoins);
      const subscription = await tx.subscription.create({
        data: {
          userId,
          planId: plan.id,
          status: SubscriptionStatus.PENDING,
          autoRenew: true,
          priceCoins: price.priceCoins,
          startedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          nextRenewalAt: periodEnd,
          cancelWindowEndsAt: cancelDeadline,
        },
      });
      return {
        id: subscription.id,
        planId: plan.id,
        planCode: plan.code,
        status: subscription.status,
        autoRenew: subscription.autoRenew,
        priceCoins: subscription.priceCoins,
        mainBalance: quote.mainBalance,
        bonusBalance: quote.bonusBalance,
        enoughCoins: quote.enoughCoins,
        missingCoins: quote.missingCoins,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        nextRenewalAt: subscription.nextRenewalAt,
        cancelDeadline,
        cancelWindowEndsAt: subscription.cancelWindowEndsAt,
      };
    });
  }

  /**
   * Step 16 (with steps 11 and 14 inside): takes the first cycle's Coins - main before bonus -
   * and starts the period. Short of Coins the wallet answers 422 INSUFFICIENT_COINS and the
   * subscription stays PENDING, so the member tops up and activates again. Anything but PENDING
   * answers 409 SUBSCRIPTION_NOT_PENDING.
   */
  async activate(userId: string, subscriptionId: string, idempotencyKey?: string) {
    const intent = await findOwnSubscription(this.prisma, userId, subscriptionId);
    if (intent.status !== SubscriptionStatus.PENDING) throw notPending(intent.status);
    const wallet = await this.wallets.walletOf(userId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // A double tap reads PENDING twice above; the row lock lets only the first one pay.
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${intent.id}::uuid FOR UPDATE`;
      const { status } = await tx.subscription.findUniqueOrThrow({
        where: { id: intent.id },
        select: { status: true },
      });
      if (status !== SubscriptionStatus.PENDING) throw notPending(status);
      const plan = await tx.membershipPlan.findUnique({ where: { id: intent.planId } });
      if (!plan) {
        throw new NotFoundException({ message: 'Plan not found', details: { reason: 'PLAN_NOT_FOUND' } });
      }
      if (!plan.isActive) {
        throw new UnprocessableEntityException({
          message: 'The plan is no longer on sale',
          details: { reason: PLAN_REASON.NOT_ACTIVE },
        });
      }
      // The period starts when the Coins move, not when the intent was quoted.
      const periodEnd = new Date(now.getTime() + plan.durationDays * DAY_MS);
      const { subscriptionCancelWindowHours } = await this.settings.get();
      const movement = await this.coins.spend(tx, wallet.id, {
        entryType: CoinEntryType.PLAN_PAYMENT,
        amountCoins: intent.priceCoins,
        referenceType: CoinReferenceType.SUBSCRIPTION_CYCLE,
        idempotencyKey,
        description: `Joined the plan ${plan.name}`,
      });
      const subscription = await tx.subscription.update({
        where: { id: intent.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          autoRenew: true,
          priceCoins: intent.priceCoins,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          nextRenewalAt: periodEnd,
          cancelWindowEndsAt: windowEndOf(periodEnd, subscriptionCancelWindowHours),
        },
      });
      const cycle = await tx.subscriptionCycle.create({
        data: {
          subscriptionId: subscription.id,
          cycleNumber: 1,
          periodStart: now,
          periodEnd,
          priceCoins: intent.priceCoins,
          status: CycleStatus.PAID,
          mainCoinsCharged: movement.mainCoins,
          bonusCoinsCharged: movement.bonusCoins,
          coinTransactionId: movement.transactionId,
        },
      });
      await this.notifications.notify(
        [userId],
        {
          type: NOTIFICATION_TYPE.SUB_RENEWED,
          title: `Đã kích hoạt gói ${plan.name}`,
          body: `Gói có hiệu lực đến ${periodEnd.toISOString().slice(0, 10)}.`,
          link: '/membership',
          payload: { subscriptionId: subscription.id, periodEnd },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_ACTIVATED,
          entityType: 'Subscription',
          entityId: subscription.id,
          projectId: null,
          actorId: userId,
          payload: { planId: plan.id, planCode: plan.code, priceCoins: intent.priceCoins, cycleNumber: 1 },
        },
        tx,
      );
      return {
        id: subscription.id,
        status: subscription.status,
        priceCoins: subscription.priceCoins,
        charged: { mainCoins: movement.mainCoins, bonusCoins: movement.bonusCoins },
        mainBalance: movement.mainBalance,
        bonusBalance: movement.bonusBalance,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        nextRenewalAt: subscription.nextRenewalAt,
        cycleNumber: cycle.cycleNumber,
        // A running plan opens every published episode, so the episode just picked is covered.
        episodeAccessGranted: true,
      };
    });
  }

  /** What the member sees: the plan, the period and when auto-renew runs next. */
  async mine(userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true, cycles: { orderBy: { cycleNumber: 'desc' }, take: 1 } },
    });
    if (!subscription) return null;
    const { plan, cycles, ...row } = subscription;
    // BR-05: the member must see the same deadline cancelAutoRenew enforces, so it is derived from
    // nextRenewalAt and the window in force now, not from the snapshot written at the last renewal
    // (which an Admin changing the window would leave stale).
    const { subscriptionCancelWindowHours } = await this.settings.get();
    const cancelWindowEndsAt =
      row.autoRenew && row.nextRenewalAt ? windowEndOf(row.nextRenewalAt, subscriptionCancelWindowHours) : null;
    return {
      ...row,
      cancelWindowEndsAt,
      cancelDeadline: cancelWindowEndsAt,
      canCancelNow: cancelWindowEndsAt !== null && cancelWindowEndsAt.getTime() > Date.now(),
      plan: { ...planOf(plan), features: plan.features },
      lastCycle: cycles[0] ?? null,
    };
  }

  /** Billed cycles of one of the member's own subscriptions, oldest first. */
  async cycles(userId: string, subscriptionId: string) {
    const subscription = await findOwnSubscription(this.prisma, userId, subscriptionId);
    return this.prisma.subscriptionCycle.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { cycleNumber: 'asc' },
    });
  }

  private async assertNoOpenPlan(tx: PrismaTx, userId: string) {
    const open = await tx.subscription.count({ where: { userId, status: { in: OPEN } } });
    if (open) {
      throw new ConflictException({
        message: 'The member already has a running plan',
        details: { reason: SUB_REASON.EXISTS },
      });
    }
  }
}
