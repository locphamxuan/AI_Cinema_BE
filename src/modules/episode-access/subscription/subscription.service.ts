import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CoinEntryType,
  CoinReferenceType,
  CycleStatus,
  SubscriptionEndReason,
  SubscriptionStatus,
  type MembershipPlan,
  type Subscription,
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

const DAY_MS = 86_400_000;

/** One cycle of a subscription, as it is shown on the screens that quote a price. */
export interface CycleLine {
  id: string;
  cycleNumber: number;
  periodStart: Date;
  periodEnd: Date;
  priceCoins: number;
  status: CycleStatus;
}

export const SUB_REASON = {
  EXISTS: 'SUBSCRIPTION_EXISTS',
  NOT_PENDING: 'SUBSCRIPTION_NOT_PENDING',
  WINDOW_CLOSED: 'CANCELLATION_WINDOW_CLOSED',
  NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
} as const;

/** A subscription counts as open while it grants or may still grant access. */
const OPEN: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.PENDING];

/** The last moment a cancellation is still accepted: the renewal date minus the window. */
const windowEndOf = (renewalAt: Date, hours: number) => new Date(renewalAt.getTime() - hours * 3_600_000);

/**
 * Steps 9, 10 and 16 from the member's side: quoting a plan, paying for it and starting the
 * period. Joining is split in two on purpose: `subscribe` only quotes the price into a PENDING
 * intent (step 10, no Coin moves), `activate` takes the Coins and starts the period (step 16:
 * steps 11 and 14 are the balance check inside it). Stopping auto-renew and changing one's mind
 * live here too. The renewal the sweeper runs lives in SubscriptionRenewalService.
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
   * The idempotency key is accepted for the contract but needs no ledger row here: replaying the
   * intent is `GET /subscriptions/me`, paying for it is `activate`.
   */
  async subscribe(userId: string, planId: string, _idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { plan, price } = await purchasablePlan(tx, planId);
      await this.assertNoOpenPlan(tx, userId);
      const now = new Date();
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
   * Step 16 (with steps 11 and 14 inside): takes the first cycle's Coins — main before bonus —
   * and starts the period. Short of Coins the wallet answers 422 INSUFFICIENT_COINS and the
   * subscription stays PENDING, so the member tops up and activates again. Anything but PENDING
   * answers 409 SUBSCRIPTION_NOT_PENDING.
   */
  async activate(userId: string, subscriptionId: string, idempotencyKey?: string) {
    const intent = await this.findMine(userId, subscriptionId);
    if (intent.status !== SubscriptionStatus.PENDING) {
      throw new ConflictException({
        message: 'Only a pending subscription can be activated',
        details: { reason: SUB_REASON.NOT_PENDING, status: intent.status },
      });
    }
    const wallet = await this.wallets.walletOf(userId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
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
          movieId: null,
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
    return {
      ...row,
      cancelDeadline: row.cancelWindowEndsAt,
      plan: { ...planOf(plan), features: plan.features },
      lastCycle: cycles[0] ?? null,
    };
  }

  /** Billed cycles of one of the member's own subscriptions, oldest first. */
  async cycles(userId: string, subscriptionId: string) {
    const subscription = await this.findMine(userId, subscriptionId);
    return this.prisma.subscriptionCycle.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { cycleNumber: 'asc' },
    });
  }

  /**
   * Step 19: stop auto-renew. Refused once the window has closed with CANCELLATION_WINDOW_CLOSED,
   * because the Coins for the next cycle may be on their way. Access runs on to the end of the paid
   * period either way, so the member loses nothing they have paid for.
   */
  async cancelAutoRenew(userId: string, subscriptionId: string) {
    const subscription = await this.findMine(userId, subscriptionId);
    const { subscriptionCancelWindowHours } = await this.settings.get();
    if (subscription.nextRenewalAt) {
      const cancelDeadline = windowEndOf(subscription.nextRenewalAt, subscriptionCancelWindowHours);
      if (cancelDeadline.getTime() <= Date.now()) {
        throw new UnprocessableEntityException({
          message: 'The window to stop the renewal of this cycle has closed',
          details: { reason: SUB_REASON.WINDOW_CLOSED, renewalAt: subscription.nextRenewalAt, cancelDeadline },
        });
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: { autoRenew: false, cancelRequestedAt: new Date(), nextRenewalAt: null },
      });
      await this.notifications.notify(
        [userId],
        {
          type: NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED,
          title: 'Đã tắt gia hạn tự động',
          body: `Gói còn hiệu lực đến ${subscription.currentPeriodEnd.toISOString().slice(0, 10)} rồi kết thúc.`,
          link: '/membership',
          payload: { subscriptionId: subscription.id, currentPeriodEnd: subscription.currentPeriodEnd },
        },
        tx,
      );
      return autoRenewOf(updated);
    });
  }

  /** Changes the mind before the period ends: auto-renew runs again at the end of the period. */
  async resumeAutoRenew(userId: string, subscriptionId: string) {
    const subscription = await this.findMine(userId, subscriptionId);
    if (subscription.autoRenew) return autoRenewOf(subscription);
    const { subscriptionCancelWindowHours } = await this.settings.get();
    return this.prisma.$transaction(async (tx) =>
      autoRenewOf(
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            autoRenew: true,
            cancelRequestedAt: null,
            nextRenewalAt: subscription.currentPeriodEnd,
            cancelWindowEndsAt: windowEndOf(subscription.currentPeriodEnd, subscriptionCancelWindowHours),
          },
        }),
      ),
    );
  }

  /** What Billing support reads: the plan, the member and every cycle that was billed. */
  async detail(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        user: { select: { id: true, fullName: true, email: true } },
        cycles: { orderBy: { cycleNumber: 'asc' } },
      },
    });
    if (!subscription) {
      throw new NotFoundException({ message: 'Subscription not found', details: { reason: SUB_REASON.NOT_FOUND } });
    }
    const { cycles, plan, user, ...row } = subscription;
    return { ...row, plan: planOf(plan), user, cycles };
  }

  /** Admin override: the plan ends now, whoever asked for it. */
  async cancelByAdmin(subscriptionId: string, actorId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const subscription = await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.CANCELLED,
          autoRenew: false,
          cancelledAt: now,
          endedAt: now,
          endReason: SubscriptionEndReason.CANCELLED_BY_ADMIN,
          nextRenewalAt: null,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_CANCELLED,
          entityType: 'Subscription',
          entityId: subscription.id,
          movieId: null,
          actorId,
          payload: { endReason: SubscriptionEndReason.CANCELLED_BY_ADMIN, note: reason ?? null },
        },
        tx,
      );
      await this.notifications.notify(
        [subscription.userId],
        {
          type: NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED,
          title: 'Gói đã được hủy',
          body: reason || 'Quản trị viên đã kết thúc gói của bạn.',
          link: '/membership',
          payload: { subscriptionId: subscription.id },
        },
        tx,
      );
      return subscription;
    });
  }

  /** Only the owner may read or change a subscription; a wrong id is a 404, not a 403. */
  private async findMine(userId: string, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
    if (!subscription) {
      throw new NotFoundException({ message: 'Subscription not found', details: { reason: SUB_REASON.NOT_FOUND } });
    }
    return subscription;
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

const planOf = (plan: MembershipPlan) => ({
  id: plan.id,
  code: plan.code,
  name: plan.name,
  period: plan.period,
  durationDays: plan.durationDays,
});

const autoRenewOf = (subscription: Subscription) => ({
  id: subscription.id,
  status: subscription.status,
  autoRenew: subscription.autoRenew,
  cancelRequestedAt: subscription.cancelRequestedAt,
  accessUntil: subscription.currentPeriodEnd,
  currentPeriodEnd: subscription.currentPeriodEnd,
  nextRenewalAt: subscription.nextRenewalAt,
});
