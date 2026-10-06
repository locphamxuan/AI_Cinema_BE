import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type CoinLot } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { CoinSpendService } from './coin-spend.service';
import { lockWallet } from './lot-usage';

const BATCH = 200;

/**
 * BR-28: bonus Coins run out. Every day the lots whose time is up are closed, their Coins leave
 * the wallet as a BONUS_EXPIRY entry and the members who lose Coins are told, so an expiring
 * batch is never a surprise.
 */
@Injectable()
export class BonusExpirySweep implements OnModuleInit {
  private readonly logger = new Logger(BonusExpirySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly notifications: NotificationService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('coin-bonus-expiry.sweep', this.config.schedules.coinExpirySweepMs, () =>
      this.expireDue().then(() => undefined),
    );
  }

  /** Closes every expired lot; returns how many Coins left the wallets. */
  async expireDue(now = new Date()): Promise<{ lots: number; coins: number }> {
    let lots = 0;
    let coins = 0;
    for (;;) {
      const due = await this.prisma.coinLot.findMany({
        where: { remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
        take: BATCH,
        include: { wallet: { select: { userId: true, mainBalance: true, bonusBalance: true } } },
      });
      if (!due.length) break;
      for (const lot of due) {
        await this.expire(lot, now);
        lots += 1;
        coins += lot.remainingAmount;
      }
      if (due.length < BATCH) break;
    }
    if (lots) this.logger.log(`Closed ${lots} expired bonus lots, ${coins} Coins`);
    return { lots, coins };
  }

  private async expire(
    lot: CoinLot & { wallet: { userId: string; mainBalance: number; bonusBalance: number } },
    now: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockWallet(tx, lot.walletId);
      // Another sweep may have closed it while this one waited for the lock.
      const { count } = await tx.coinLot.updateMany({
        where: { id: lot.id, closedAt: null, remainingAmount: { gt: 0 } },
        data: { remainingAmount: 0, closedAt: now },
      });
      if (count === 0) return;
      await this.coins.expireBonus(tx, lot.walletId, {
        id: lot.id,
        amount: lot.remainingAmount,
        expiresAt: lot.expiresAt,
      });
      await this.notifications.notify(
        [lot.wallet.userId],
        {
          type: NOTIFICATION_TYPE.COIN_BONUS_EXPIRING,
          title: `${lot.remainingAmount} bonus Coins đã hết hạn`,
          body: 'Lô bonus Coin của bạn đã hết hạn và không còn dùng được.',
          link: '/wallet',
          payload: { lotId: lot.id, amount: lot.remainingAmount, expiresAt: lot.expiresAt },
        },
        tx,
      );
    });
  }
}
