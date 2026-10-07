import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';

const BATCH = 100;

/** Orders old enough that the gateway should have answered already. */
const RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * `payment-reconcile.sweep`: lists the PENDING payment attempts that never got a gateway
 * callback, so Billing sees what to ask the gateway about. Settling itself stays in the webhook:
 * without a gateway answer there is nothing to credit, and the expiry sweep closes what nobody
 * pays for.
 */
@Injectable()
export class PaymentReconcileSweep implements OnModuleInit {
  private readonly logger = new Logger(PaymentReconcileSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('payment-reconcile.sweep', this.config.schedules.paymentReconcileSweepMs, () =>
      this.reconcileDue().then(() => undefined),
    );
  }

  /** Counts the attempts still waiting for a callback; returns how many are waiting. */
  async reconcileDue(now = new Date()): Promise<{ pending: number }> {
    const threshold = new Date(now.getTime() - RECONCILE_AFTER_MS);
    let pending = 0;
    for (;;) {
      const stale = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: { lte: threshold },
          callbacks: { none: { handledAt: { not: null } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, coinTopUpId: true, provider: true, amountVnd: true },
        take: BATCH,
      });
      if (!stale.length) break;
      pending += stale.length;
      for (const attempt of stale) {
        this.logger.warn(
          `Payment ${attempt.id} of top-up ${attempt.coinTopUpId} (${attempt.provider} ${attempt.amountVnd} VND) is still PENDING with no gateway callback; reconcile with the provider`,
        );
      }
      if (stale.length < BATCH) break;
    }
    if (pending) this.logger.log(`Reconciled ${pending} payment attempt(s) waiting for a gateway callback`);
    return { pending };
  }
}
