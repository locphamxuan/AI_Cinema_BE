import { Inject, Injectable, Logger, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { CoinTopUpService } from './coin-topup.service';
import { TOPUP_REASON } from './constants/topup-reason';
import { PaymentGatewayService } from './gateways/payment-gateway.service';

const BATCH = 100;

/** Attempts old enough that the gateway should have answered already. */
const RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * `payment-reconcile.sweep`: asks the gateway about PENDING attempts that never got a
 * callback, and settles the ones the gateway confirms. Anything uncertain is left alone
 * for the next run (or the expiry sweep): the sweep never fails an order on a guess.
 */
@Injectable()
export class PaymentReconcileSweep implements OnModuleInit {
  private readonly logger = new Logger(PaymentReconcileSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly topUps: CoinTopUpService,
    private readonly gateways: PaymentGatewayService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('payment-reconcile.sweep', this.config.schedules.paymentReconcileSweepMs, () =>
      this.reconcileDue().then(() => undefined),
    );
  }

  /** Probes stale attempts; returns how many waited, settled and failed. */
  async reconcileDue(now = new Date()): Promise<{ pending: number; settled: number; failed: number }> {
    const threshold = new Date(now.getTime() - RECONCILE_AFTER_MS);
    let pending = 0;
    let settled = 0;
    let failed = 0;
    for (;;) {
      const stale = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: { lte: threshold },
          callbacks: { none: { handledAt: { not: null } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, coinTopUpId: true, provider: true, providerTxnId: true, amountVnd: true, createdAt: true },
        take: BATCH,
      });
      if (!stale.length) break;
      pending += stale.length;
      for (const attempt of stale) {
        try {
          const probe = await this.gateways.reconcilePayment({
            provider: attempt.provider,
            providerTxnId: attempt.providerTxnId,
            referenceDate: attempt.createdAt,
          });
          if (probe.outcome === 'PAID') {
            await this.topUps.settle({
              paymentId: attempt.id,
              providerPaymentId: probe.providerPaymentId ?? attempt.providerTxnId,
              amountVnd: probe.amountVnd ?? attempt.amountVnd,
              // Same key as the webhook path: whichever arrives first wins, the other replays.
              idempotencyKey: `topup:${attempt.coinTopUpId}`,
              paidAt: probe.paidAt,
            });
            settled += 1;
            this.logger.log(`Reconciled payment ${attempt.id} of top-up ${attempt.coinTopUpId} as PAID`);
          } else if (probe.outcome === 'FAILED') {
            await this.topUps.markPaymentFailed(
              attempt.id,
              'The gateway reports no payment for this order',
              PaymentStatus.FAILED,
            );
            failed += 1;
          } else {
            this.logger.warn(
              `Payment ${attempt.id} of top-up ${attempt.coinTopUpId} (${attempt.provider} ${attempt.amountVnd} VND) is still PENDING with no gateway answer; will probe again next run`,
            );
          }
        } catch (error) {
          if (isAlreadySettled(error)) {
            settled += 1;
            continue;
          }
          this.logger.warn(
            `Reconcile of payment ${attempt.id} failed (${error instanceof Error ? error.message : String(error)}); will retry next run`,
          );
        }
      }
      if (stale.length < BATCH) break;
    }
    if (pending) this.logger.log(`Reconciled ${pending} attempt(s): ${settled} settled, ${failed} failed`);
    return { pending, settled, failed };
  }
}

/** A concurrent webhook credited first: the sweep has nothing left to do. */
function isAlreadySettled(error: unknown): boolean {
  if (
    error instanceof UnprocessableEntityException &&
    (error.getResponse() as { details?: { reason?: string } })?.details?.reason === TOPUP_REASON.ALREADY_SETTLED
  ) {
    return true;
  }
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
