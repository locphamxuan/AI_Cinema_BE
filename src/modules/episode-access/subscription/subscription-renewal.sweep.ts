import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { SubscriptionRenewalService } from './subscription-renewal.service';

const BATCH = 50;

/**
 * `subscription-renewal.sweep`: every ACTIVE plan whose renewal date has passed is charged Coins,
 * main before bonus; PAST_DUE plans are retried and ended once their grace period is over; plans
 * whose auto-renew was stopped end with their period. Every pass is guarded on the status (or walks
 * a cursor), so a plan a renewal just moved forward is not picked up again and the loops always end.
 */
@Injectable()
export class SubscriptionRenewalSweep implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionRenewalSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renewals: SubscriptionRenewalService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('subscription-renewal.sweep', this.config.schedules.subscriptionRenewalSweepMs, () =>
      this.renewDue().then(() => undefined),
    );
  }

  /** Renews what is due, then ends what stayed unpaid; returns what each pass did. */
  async renewDue(now = new Date()): Promise<{ renewed: number; expired: number }> {
    let renewed = 0;
    for (;;) {
      const due = await this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE, autoRenew: true, nextRenewalAt: { lte: now } },
        orderBy: { nextRenewalAt: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!due.length) break;
      for (const { id } of due) {
        if ((await this.renewals.renew(id, now)).renewed) renewed += 1;
      }
      if (due.length < BATCH) break;
    }

    // Plans in their grace period: retry each one, and end those still unpaid once the grace is over.
    let expired = 0;
    let cursor: string | undefined;
    for (;;) {
      const pastDue = await this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.PAST_DUE, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!pastDue.length) break;
      for (const { id } of pastDue) {
        if ((await this.renewals.renew(id, now)).renewed) renewed += 1;
        else if (await this.renewals.expire(id, now)) expired += 1;
      }
      cursor = pastDue[pastDue.length - 1].id;
      if (pastDue.length < BATCH) break;
    }

    // Plans whose auto-renew was stopped end with their paid period (BR-11).
    for (;;) {
      const over = await this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE, autoRenew: false, currentPeriodEnd: { lte: now } },
        orderBy: { currentPeriodEnd: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!over.length) break;
      for (const { id } of over) {
        if (await this.renewals.lapse(id, now)) expired += 1;
      }
      if (over.length < BATCH) break;
    }

    if (renewed || expired) this.logger.log(`Renewed ${renewed} plan(s), ended ${expired} plan(s)`);
    return { renewed, expired };
  }
}
