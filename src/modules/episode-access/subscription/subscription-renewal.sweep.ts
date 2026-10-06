import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { SubscriptionRenewalService } from './subscription-renewal.service';

const BATCH = 50;

/**
 * `subscription-renewal.sweep`: every ACTIVE plan whose renewal date has passed is charged Coins,
 * main before bonus, and every plan still unpaid after its grace period ends. Both passes are
 * guarded on the status, so a plan a renewal just moved forward is not picked up again in the same
 * run and the loop always ends.
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

    let expired = 0;
    for (;;) {
      const unpaid = await this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.PAST_DUE, nextRenewalAt: { lte: now } },
        orderBy: { nextRenewalAt: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!unpaid.length) break;
      for (const { id } of unpaid) {
        if (await this.renewals.expire(id, now)) expired += 1;
      }
      if (unpaid.length < BATCH) break;
    }

    if (renewed || expired) this.logger.log(`Renewed ${renewed} plan(s), ended ${expired} unpaid one(s)`);
    return { renewed, expired };
  }
}
