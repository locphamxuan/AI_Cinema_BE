import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  CoinEntryType,
  CoinLotSource,
  CoinReferenceType,
  RewardPrizeType,
  RewardSpinStatus,
  type RewardPrize,
  type RewardSpin,
} from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';
import { PlanDaysGrantService } from '../subscription/plan-days-grant.service';

export const SPIN_REASON = {
  NONE_AVAILABLE: 'NO_SPIN_AVAILABLE',
  NO_PRIZE: 'NO_PRIZE_CONFIGURED',
  TAKEN: 'SPIN_ALREADY_USED',
} as const;

const HISTORY_LIMIT = 10;

/** What a prize looks like to the member: never its weight, which is the Admin's business. */
const prizeView = (prize: Pick<RewardPrize, 'id' | 'code' | 'name' | 'type' | 'bonusCoins' | 'planDays'>) => ({
  id: prize.id,
  code: prize.code,
  name: prize.name,
  type: prize.type,
  bonusCoins: prize.bonusCoins,
  planDays: prize.planDays,
});

/**
 * A spin as the member sees it. The prize comes from the copy kept on the spin, so a prize the
 * Admin later renamed or deleted still shows what was won; `id` is null once it is deleted.
 */
const spinView = (spin: RewardSpin) => ({
  id: spin.id,
  status: spin.status,
  grantedAt: spin.grantedAt,
  spunAt: spin.spunAt,
  prize: spin.prizeType
    ? {
        id: spin.prizeId,
        name: spin.prizeName ?? '',
        type: spin.prizeType,
        bonusCoins: spin.bonusCoins,
        planDays: spin.planDays,
      }
    : null,
  bonusCoins: spin.bonusCoins,
  planDays: spin.planDays,
});

/** A weight's share of the active weights, in percent with two decimals (weights are basis points of 100 %). */
export function chancePercent(weight: number, total: number): number {
  return total > 0 ? Math.round((weight / total) * 10_000) / 100 : 0;
}

/** Draws one prize with probability weight / total weight, from a CSPRNG. */
export function drawPrize<T extends { weight: number }>(prizes: T[], pick = randomInt): T {
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  let ticket = pick(total);
  for (const prize of prizes) {
    if (ticket < prize.weight) return prize;
    ticket -= prize.weight;
  }
  return prizes[prizes.length - 1];
}

/**
 * BR-09: the reward wheel. A milestone check-in earns a spin; spinning draws one of the Admin's
 * prizes - bonus Coins, or days of the monthly plan (added to a running plan, or a plan of that
 * many days without auto-renew). Plan days are a promotion cost, kept on the spin (BR-49).
 */
@Injectable()
export class RewardSpinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
    private readonly planDays: PlanDaysGrantService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The wheel screen: spins left, the prizes on the wheel and the latest results. */
  async mine(userId: string) {
    const [available, prizes, history] = await Promise.all([
      this.prisma.rewardSpin.count({ where: { userId, status: RewardSpinStatus.AVAILABLE } }),
      this.prisma.rewardPrize.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.rewardSpin.findMany({
        where: { userId, status: RewardSpinStatus.USED },
        orderBy: { spunAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ]);
    // The member may see the odds (BR-09 transparency), never the raw weights the Admin set.
    const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
    return {
      availableSpins: available,
      prizes: prizes.map((prize) => ({ ...prizeView(prize), chancePercent: chancePercent(prize.weight, total) })),
      history: history.map(spinView),
    };
  }

  /** Uses the member's oldest spin. Replaying the same Idempotency-Key answers the first result. */
  async spin(userId: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const done = await this.prisma.rewardSpin.findUnique({ where: { idempotencyKey } });
      if (done && done.userId === userId) return this.resultOf(done);
      if (done) {
        throw new ConflictException({
          message: 'This Idempotency-Key was already used',
          details: { reason: SPIN_REASON.TAKEN },
        });
      }
    }
    const spin = await this.prisma.rewardSpin.findFirst({
      where: { userId, status: RewardSpinStatus.AVAILABLE },
      orderBy: { grantedAt: 'asc' },
    });
    if (!spin) {
      throw new UnprocessableEntityException({
        message: 'There is no spin left to use',
        details: { reason: SPIN_REASON.NONE_AVAILABLE },
      });
    }

    const used = await this.prisma.$transaction(async (tx) => {
      const prize = drawPrize(await this.eligiblePrizes(tx, userId));
      const now = new Date();
      // Claiming the row on its status makes a double tap use the spin once.
      const claimed = await tx.rewardSpin.updateMany({
        where: { id: spin.id, status: RewardSpinStatus.AVAILABLE },
        data: {
          status: RewardSpinStatus.USED,
          spunAt: now,
          prizeId: prize.id,
          prizeName: prize.name,
          prizeType: prize.type,
          idempotencyKey,
        },
      });
      if (!claimed.count) {
        throw new ConflictException({ message: 'This spin was just used', details: { reason: SPIN_REASON.TAKEN } });
      }
      const payout = await this.payOut(tx, userId, spin.id, prize, now);
      const row = await tx.rewardSpin.update({ where: { id: spin.id }, data: payout });
      await this.record(tx, userId, row, prize);
      return row;
    });
    return this.resultOf(used);
  }

  /**
   * Active prizes; plan days only when the member could actually receive them. The rows are locked
   * FOR SHARE until the spin commits, so an Admin deleting or switching off the drawn prize waits
   * for it instead of breaking the payout; a prize deleted just before is simply not drawn.
   */
  private async eligiblePrizes(tx: PrismaTx, userId: string): Promise<RewardPrize[]> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "reward_prizes" WHERE "is_active" = true ORDER BY "id" FOR SHARE`;
    const prizes = locked.length
      ? await tx.rewardPrize.findMany({ where: { id: { in: locked.map((row) => row.id) }, isActive: true } })
      : [];
    const planPossible =
      prizes.some((p) => p.type === RewardPrizeType.PLAN_DAYS) &&
      Boolean((await this.planDays.openPlan(tx, userId)) ?? (await this.planDays.giftPlan(tx)));
    const eligible = prizes.filter((p) => p.type === RewardPrizeType.BONUS_COIN || planPossible);
    if (!eligible.length) {
      throw new UnprocessableEntityException({
        message: 'No prize is on the wheel yet',
        details: { reason: SPIN_REASON.NO_PRIZE },
      });
    }
    return eligible;
  }

  private async payOut(tx: PrismaTx, userId: string, spinId: string, prize: RewardPrize, now: Date) {
    if (prize.type === RewardPrizeType.BONUS_COIN) {
      const wallet = await this.wallets.walletOf(userId, tx);
      const movement = await this.coins.credit(
        tx,
        wallet.id,
        {
          entryType: CoinEntryType.REWARD_SPIN,
          bonusAmount: prize.bonusCoins!,
          lotSource: CoinLotSource.REWARD_SPIN,
          referenceType: CoinReferenceType.REWARD_SPIN,
          referenceId: spinId,
          description: `Reward spin: ${prize.name}`,
        },
        now,
      );
      return { bonusCoins: movement.bonusCoins, coinTransactionId: movement.transactionId };
    }
    const granted = await this.planDays.grant(tx, userId, prize.planDays!, now);
    // eligiblePrizes only offers plan days when a plan can be given, inside this transaction.
    if (!granted) {
      throw new UnprocessableEntityException({
        message: 'No monthly plan is on sale',
        details: { reason: SPIN_REASON.NO_PRIZE },
      });
    }
    return {
      planDays: prize.planDays,
      subscriptionId: granted.subscriptionId,
      promoValueCoins: granted.promoValueCoins,
    };
  }

  private async record(tx: PrismaTx, userId: string, spin: RewardSpin, prize: RewardPrize) {
    const won =
      prize.type === RewardPrizeType.BONUS_COIN
        ? `${spin.bonusCoins} Coin thưởng đã vào ví.`
        : `${spin.planDays} ngày gói Tháng đã được cộng.`;
    await this.notifications.notify(
      [userId],
      {
        type: NOTIFICATION_TYPE.REWARD_SPIN_WON,
        title: `Vòng quay: ${prize.name}`,
        body: won,
        link: prize.type === RewardPrizeType.BONUS_COIN ? '/wallet' : '/membership',
        payload: { spinId: spin.id, prizeId: prize.id },
      },
      tx,
    );
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.REWARD_SPIN_USED,
        entityType: 'RewardSpin',
        entityId: spin.id,
        projectId: null,
        actorId: userId,
        payload: {
          prizeId: prize.id,
          prizeType: prize.type,
          bonusCoins: spin.bonusCoins,
          planDays: spin.planDays,
          promoValueCoins: spin.promoValueCoins,
        },
      },
      tx,
    );
  }

  private async resultOf(spin: RewardSpin) {
    const [balance, plan, availableSpins] = await Promise.all([
      this.wallets.walletOf(spin.userId),
      spin.subscriptionId
        ? this.prisma.subscription.findUnique({
            where: { id: spin.subscriptionId },
            select: { currentPeriodEnd: true },
          })
        : null,
      this.prisma.rewardSpin.count({ where: { userId: spin.userId, status: RewardSpinStatus.AVAILABLE } }),
    ]);
    return {
      ...spinView(spin),
      planActiveUntil: plan?.currentPeriodEnd ?? null,
      mainBalance: balance.mainBalance,
      bonusBalance: balance.bonusBalance,
      availableSpins,
    };
  }
}
