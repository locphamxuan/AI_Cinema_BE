import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Subscription } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { assertRunning, findOwnSubscription, SUB_REASON, windowEndOf } from './subscription-rules';

const autoRenewOf = (subscription: Subscription) => ({
  id: subscription.id,
  status: subscription.status,
  autoRenew: subscription.autoRenew,
  cancelRequestedAt: subscription.cancelRequestedAt,
  accessUntil: subscription.currentPeriodEnd,
  currentPeriodEnd: subscription.currentPeriodEnd,
  nextRenewalAt: subscription.nextRenewalAt,
});

/** Step 19 from the member's side: stopping auto-renew, and changing one's mind before the period ends. */
@Injectable()
export class SubscriptionAutoRenewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Step 19: stop auto-renew. Refused once the window has closed with CANCELLATION_WINDOW_CLOSED,
   * because the Coins for the next cycle may be on their way. Access runs on to the end of the paid
   * period either way, so the member loses nothing they have paid for.
   */
  async cancelAutoRenew(userId: string, subscriptionId: string) {
    const subscription = await findOwnSubscription(this.prisma, userId, subscriptionId);
    assertRunning(subscription);
    // Already stopped: answer the same state again, without a second notification.
    if (!subscription.autoRenew) return autoRenewOf(subscription);
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
    const subscription = await findOwnSubscription(this.prisma, userId, subscriptionId);
    assertRunning(subscription);
    if (subscription.currentPeriodEnd.getTime() <= Date.now()) {
      throw new ConflictException({
        message: 'The paid period has ended; join the plan again instead',
        details: { reason: SUB_REASON.ENDED, currentPeriodEnd: subscription.currentPeriodEnd },
      });
    }
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
}
