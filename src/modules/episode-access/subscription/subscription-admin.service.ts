import { ConflictException, Injectable } from '@nestjs/common';
import { SubscriptionEndReason, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { planOf, SUB_REASON, subscriptionNotFound } from './subscription-rules';

/** The back office's side of a subscription: reading it for support and ending it with Admin rights. */
@Injectable()
export class SubscriptionAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

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
      throw subscriptionNotFound();
    }
    const { cycles, plan, user, ...row } = subscription;
    return { ...row, plan: planOf(plan), user, cycles };
  }

  /** Admin override: an open plan ends now, whoever asked for it; an ended one keeps its history. */
  async cancelByAdmin(subscriptionId: string, actorId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const ended = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          status: { in: [SubscriptionStatus.PENDING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          autoRenew: false,
          cancelledAt: now,
          endedAt: now,
          endReason: SubscriptionEndReason.CANCELLED_BY_ADMIN,
          nextRenewalAt: null,
        },
      });
      const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription) {
        throw subscriptionNotFound();
      }
      if (!ended.count) {
        throw new ConflictException({ message: 'This plan has already ended', details: { reason: SUB_REASON.ENDED } });
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.SUBSCRIPTION_CANCELLED,
          entityType: 'Subscription',
          entityId: subscription.id,
          projectId: null,
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
}
