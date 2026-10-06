import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TopUpStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';

const BATCH = 100;

/**
 * `coin-topup-expire.sweep`: an order left PENDING past its expiry is closed, so the member cannot
 * pay for it hours later and the table does not fill with abandoned rows. The row itself stays: it
 * is the record of what was offered.
 */
@Injectable()
export class TopUpExpirySweep implements OnModuleInit {
  private readonly logger = new Logger(TopUpExpirySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('coin-topup-expire.sweep', this.config.schedules.coinTopUpSweepMs, () =>
      this.expireDue().then(() => undefined),
    );
  }

  /** Closes the orders nobody finished; returns how many were closed. */
  async expireDue(now = new Date()): Promise<number> {
    let closed = 0;
    for (;;) {
      const stale = await this.prisma.coinTopUp.findMany({
        where: { status: TopUpStatus.PENDING, expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!stale.length) break;
      // Guarded on the status, so two sweeps cannot both claim the same order.
      const { count } = await this.prisma.coinTopUp.updateMany({
        where: { id: { in: stale.map(({ id }) => id) }, status: TopUpStatus.PENDING },
        data: { status: TopUpStatus.EXPIRED, failureReason: 'The order expired before it was paid' },
      });
      closed += count;
      if (stale.length < BATCH) break;
    }
    if (closed) this.logger.log(`Closed ${closed} top-up order(s) nobody finished`);
    return closed;
  }
}
