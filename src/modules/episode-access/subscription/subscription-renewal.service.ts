import { Injectable } from '@nestjs/common';
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
import { currentPrice } from '../membership-plan/membership-plan.service';

const DAY_MS = 86_400_000;

/** ACTIVE plans renew on their date; PAST_DUE ones are retried until the grace period ends. */
const RENEWABLE: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

/**
 * What one renewal attempt did, so the sweeper can count it without reading the row again.
 */
export interface RenewalOutcome {
  renewed: boolean;
  expired: boolean;
  cycleNumber: number | null;
}

/**
 * Step 19, the part the sweeper runs: charging the next cycle and ending plans that stayed unpaid.
 * A renewal that finds no Coins does not throw the transaction away; it writes the failed cycle and
 * moves the subscription to PAST_DUE, so the attempt is on record and can be retried during the
 * grace period. Plans whose auto-renew was stopped end at the close of their period (`lapse`).
 */
@Injectable()
export class SubscriptionRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly settings: PlatformSettingService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Charges one cycle. The price in force applies from now on; what earlier cycles paid is left as
   * it is, which is why the plan keeps its price history instead of a single column.
   */
  async renew(subscriptionId: string, now = new Date()): Promise<RenewalOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription || !RENEWABLE.includes(subscription.status) || !subscription.autoRenew) {
        return { renewed: false, expired: false, cycleNumber: null };
      }
      const retrying = subscription.status === SubscriptionStatus.PAST_DUE;
      const plan = await tx.membershipPlan.findUnique({ where: { id: subscription.planId } });
      if (!plan || !plan.isActive) return { renewed: false, expired: false, cycleNumber: null };

      const price = (await currentPrice(tx, plan.id, now)) ?? { priceCoins: subscription.priceCoins };
      const cycleNumber = subscription.renewalsCompleted + 2;
      const periodEnd = new Date(subscription.currentPeriodEnd.getTime() + plan.durationDays * DAY_MS);
      const wallet = await this.wallets.walletOf(subscription.userId, tx);

      let movement: { transactionId: string; mainCoins: number; bonusCoins: number };
      try {
        movement = await this.coins.spend(
          tx,
          wallet.id,
          {
            entryType: CoinEntryType.PLAN_RENEWAL,
            amountCoins: price.priceCoins,
            referenceType: CoinReferenceType.SUBSCRIPTION_CYCLE,
            idempotencyKey: `sub:${subscription.id}:cycle:${cycleNumber}`,
            description: `Renewal cycle ${cycleNumber}`,
          },
          now,
        );
      } catch (error) {
        // A retry that is still short leaves the FAILED cycle and the grace deadline as they are.
        if (!retrying) await this.markPastDue(tx, subscription, plan, cycleNumber, periodEnd, price.priceCoins, error);
        return { renewed: false, expired: false, cycleNumber };
      }

      const paid = {
        periodStart: subscription.currentPeriodEnd,
        periodEnd,
        priceCoins: price.priceCoins,
        status: CycleStatus.PAID,
        failureReason: null,
        mainCoinsCharged: movement.mainCoins,
        bonusCoinsCharged: movement.bonusCoins,
        coinTransactionId: movement.transactionId,
      };
      // A retry pays the cycle the failed attempt already wrote.
      await tx.subscriptionCycle.upsert({
        where: { subscriptionId_cycleNumber: { subscriptionId: subscription.id, cycleNumber } },
        create: { subscriptionId: subscription.id, cycleNumber, ...paid },
        update: paid,
      });
      const { subscriptionCancelWindowHours } = await this.settings.get();
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          priceCoins: price.priceCoins,
          currentPeriodStart: subscription.currentPeriodEnd,
          currentPeriodEnd: periodEnd,
          nextRenewalAt: periodEnd,
          cancelWindowEndsAt: new Date(periodEnd.getTime() - subscriptionCancelWindowHours * 3_600_000),
          renewalsCompleted: subscription.renewalsCompleted + 1,
          lastRenewedAt: now,
        },
      });
      await this.notifications.notify(
        [subscription.userId],
        {
          type: NOTIFICATION_TYPE.SUB_RENEWED,
          title: 'Đã gia hạn gói',
          body: `Chu kỳ ${cycleNumber} đã thanh toán, hiệu lực đến ${periodEnd.toISOString().slice(0, 10)}.`,
          link: '/membership',
          payload: { subscriptionId: subscription.id, cycleNumber, periodEnd },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_RENEWED,
          entityType: 'Subscription',
          entityId: subscription.id,
          movieId: null,
          actorId: null,
          payload: { cycleNumber, priceCoins: price.priceCoins, periodEnd },
        },
        tx,
      );
      return { renewed: true, expired: false, cycleNumber };
    });
  }

  /**
   * A plan whose auto-renew was stopped has reached the end of its paid period: it ends as
   * NOT_RENEWED and the member is back on the free tier (BR-11). Without this the row would stay
   * ACTIVE for good and block the member from ever joining a plan again.
   */
  async lapse(subscriptionId: string, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE || subscription.autoRenew) return false;
      if (subscription.currentPeriodEnd.getTime() > now.getTime()) return false;
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.EXPIRED,
          endedAt: subscription.currentPeriodEnd,
          endReason: SubscriptionEndReason.NOT_RENEWED,
          nextRenewalAt: null,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_EXPIRED,
          entityType: 'Subscription',
          entityId: subscription.id,
          movieId: null,
          actorId: null,
          payload: {
            endReason: SubscriptionEndReason.NOT_RENEWED,
            renewalsCompleted: subscription.renewalsCompleted,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
        },
        tx,
      );
      await this.notifications.notify(
        [subscription.userId],
        {
          type: NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED,
          title: 'Gói đã kết thúc',
          body: 'Gói Tháng đã hết kỳ và không gia hạn. Tập đã mở khóa bằng Coin vẫn xem được.',
          link: '/membership',
          payload: { subscriptionId: subscription.id },
        },
        tx,
      );
      return true;
    });
  }

  /**
   * The grace period is over: the plan ends. The member keeps whatever the paid period still covers
   * and is told why, because nothing about the end is a surprise after the failed notifications.
   */
  async expire(subscriptionId: string, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription || subscription.status !== SubscriptionStatus.PAST_DUE) return false;
      // nextRenewalAt doubles as the retry moment, so it is empty only when the grace is over.
      if (subscription.nextRenewalAt && subscription.nextRenewalAt.getTime() > now.getTime()) return false;
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.EXPIRED,
          autoRenew: false,
          endedAt: now,
          endReason: SubscriptionEndReason.PAYMENT_FAILED,
          nextRenewalAt: null,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_EXPIRED,
          entityType: 'Subscription',
          entityId: subscription.id,
          movieId: null,
          actorId: null,
          payload: {
            endReason: SubscriptionEndReason.PAYMENT_FAILED,
            renewalsCompleted: subscription.renewalsCompleted,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
        },
        tx,
      );
      await this.notifications.notify(
        [subscription.userId],
        {
          type: NOTIFICATION_TYPE.SUB_RENEWAL_FAILED,
          title: 'Gói đã kết thúc',
          body: 'Gia hạn không thành công nên gói đã hết hạn. Nạp Coin để chọn lại gói.',
          link: '/membership',
          payload: { subscriptionId: subscription.id },
        },
        tx,
      );
      return true;
    });
  }

  /**
   * The wallet could not cover the cycle. The attempt is written as FAILED, the status becomes
   * PAST_DUE and nextRenewalAt becomes the end of the grace period the Admin set; the sweeper
   * retries on every run until then. Only the status moves, never the period, so access stops at
   * the end of the period already paid for and comes back the moment a retry succeeds.
   */
  private async markPastDue(
    tx: PrismaTx,
    subscription: Subscription,
    plan: MembershipPlan,
    cycleNumber: number,
    periodEnd: Date,
    priceCoins: number,
    cause: unknown,
  ): Promise<void> {
    const { planRenewalGraceHours } = await this.settings.get();
    const retryAt = new Date(Date.now() + Math.max(1, planRenewalGraceHours) * 3_600_000);
    await tx.subscriptionCycle.create({
      data: {
        subscriptionId: subscription.id,
        cycleNumber,
        periodStart: subscription.currentPeriodEnd,
        periodEnd,
        priceCoins,
        status: CycleStatus.FAILED,
        failureReason: cause instanceof Error ? cause.message : 'The wallet could not cover the price',
      },
    });
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.PAST_DUE, nextRenewalAt: retryAt },
    });
    await this.notifications.notify(
      [subscription.userId],
      {
        type: NOTIFICATION_TYPE.SUB_RENEWAL_FAILED,
        title: 'Gia hạn thất bại',
        body: `Ví chưa đủ Coin cho chu kỳ ${cycleNumber}. Gói tạm dừng; nạp Coin trước khi hết hạn chờ để tránh mất gói.`,
        link: '/wallet',
        payload: { subscriptionId: subscription.id, cycleNumber, retryAt },
      },
      tx,
    );
  }
}
