import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PaymentStatus, TopUpStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';

const BATCH = 100;

/**
 * `coin-topup-expire.sweep`: an order left PENDING past its expiry is closed, so the member cannot
 * pay for it hours later and the table does not fill with abandoned rows. The row itself stays: it
 * is the record of what was offered. The order's payment attempts die with it, so a late gateway
 * answer finds nothing payable.
 */
@Injectable()
export class TopUpExpirySweep implements OnModuleInit {
  private readonly logger = new Logger(TopUpExpirySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly notifications?: NotificationService,
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
        select: { id: true, userId: true },
        take: BATCH,
      });
      if (!stale.length) break;
      // Guarded on the status, so two sweeps cannot both claim the same order.
      const { count } = await this.prisma.coinTopUp.updateMany({
        where: { id: { in: stale.map(({ id }) => id) }, status: TopUpStatus.PENDING },
        data: { status: TopUpStatus.EXPIRED, failureReason: 'The order expired before it was paid' },
      });
      await this.prisma.payment.updateMany({
        where: { coinTopUpId: { in: stale.map(({ id }) => id) }, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.EXPIRED, failureReason: 'The order expired before it was paid' },
      });
      closed += count;
      for (const order of stale) {
        await this.notifications?.notify([order.userId], {
          type: NOTIFICATION_TYPE.COIN_TOPUP_FAILED,
          title: 'Đơn nạp Coin đã hết hạn',
          body: 'Đơn chưa được thanh toán kịp nên đã đóng; không có khoản tiền nào bị trừ. Tạo đơn mới để nạp.',
          link: '/wallet',
          payload: { topUpId: order.id },
        });
      }
      if (stale.length < BATCH) break;
    }
    if (closed) this.logger.log(`Closed ${closed} top-up order(s) nobody finished`);
    return closed;
  }
}
