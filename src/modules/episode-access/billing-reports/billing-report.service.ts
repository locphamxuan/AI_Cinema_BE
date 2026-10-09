import { Injectable } from '@nestjs/common';
import { CycleStatus, SubscriptionEndReason, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

const DAY_MS = 86_400_000;

export interface ReportRange {
  from: Date;
  to: Date;
}

/** Reads the billing history, so revenue and churn are two views of the same cycles. */
@Injectable()
export class BillingReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Revenue by plan over a range: only PAID cycles count, each split into the main Coins really
   * paid and the bonus Coins spent, so a report never counts a bonus Coin as revenue twice.
   */
  async revenue(range: ReportRange) {
    const cycles = await this.prisma.subscriptionCycle.findMany({
      where: { status: CycleStatus.PAID, attemptedAt: { gte: range.from, lte: range.to } },
      select: {
        priceCoins: true,
        mainCoinsCharged: true,
        bonusCoinsCharged: true,
        attemptedAt: true,
        subscription: { select: { plan: { select: { id: true, code: true, name: true } } } },
      },
    });
    const byPlan = new Map<
      string,
      { plan: unknown; cycles: number; coins: number; mainCoins: number; bonusCoins: number }
    >();
    let mainCoins = 0;
    let bonusCoins = 0;
    for (const cycle of cycles) {
      const plan = cycle.subscription.plan;
      const key = plan.id;
      const row = byPlan.get(key) ?? { plan, cycles: 0, coins: 0, mainCoins: 0, bonusCoins: 0 };
      row.cycles += 1;
      row.coins += cycle.priceCoins;
      row.mainCoins += cycle.mainCoinsCharged;
      row.bonusCoins += cycle.bonusCoinsCharged;
      byPlan.set(key, row);
      mainCoins += cycle.mainCoinsCharged;
      bonusCoins += cycle.bonusCoinsCharged;
    }
    return {
      from: range.from,
      to: range.to,
      totals: {
        paidCycles: cycles.length,
        coins: cycles.reduce((sum, cycle) => sum + cycle.priceCoins, 0),
        mainCoins,
        bonusCoins,
      },
      byPlan: [...byPlan.values()].sort((a, b) => b.coins - a.coins),
    };
  }

  /** Revenue day by day, for the chart on the Admin dashboard. */
  async revenueByDay(range: ReportRange) {
    const cycles = await this.prisma.subscriptionCycle.findMany({
      where: { status: CycleStatus.PAID, attemptedAt: { gte: range.from, lte: range.to } },
      select: { attemptedAt: true, mainCoinsCharged: true, bonusCoinsCharged: true },
      orderBy: { attemptedAt: 'asc' },
    });
    const byDay = new Map<string, { date: string; cycles: number; mainCoins: number; bonusCoins: number }>();
    for (const cycle of cycles) {
      const date = cycle.attemptedAt.toISOString().slice(0, 10);
      const row = byDay.get(date) ?? { date, cycles: 0, mainCoins: 0, bonusCoins: 0 };
      row.cycles += 1;
      row.mainCoins += cycle.mainCoinsCharged;
      row.bonusCoins += cycle.bonusCoinsCharged;
      byDay.set(date, row);
    }
    return [...byDay.values()];
  }

  /**
   * Churn over a range: how many plans started, renewed, were cancelled, were left to expire, or
   * never renewed. A member whose renewal failed is counted as churn only once the plan really ends.
   */
  async churn(range: ReportRange) {
    const inRange = { gte: range.from, lte: range.to };
    const [started, renewed, cancelledByMember, cancelledByAdmin, expiredForPayment, expiredUnused, failed] =
      await Promise.all([
        this.prisma.subscription.count({ where: { startedAt: inRange } }),
        this.prisma.subscriptionCycle.count({
          where: { status: CycleStatus.PAID, cycleNumber: { gt: 1 }, attemptedAt: inRange },
        }),
        this.prisma.subscription.count({
          where: { endedAt: inRange, endReason: SubscriptionEndReason.CANCELLED_BY_MEMBER },
        }),
        this.prisma.subscription.count({
          where: { endedAt: inRange, endReason: SubscriptionEndReason.CANCELLED_BY_ADMIN },
        }),
        this.prisma.subscription.count({
          where: { endedAt: inRange, endReason: SubscriptionEndReason.PAYMENT_FAILED },
        }),
        this.prisma.subscription.count({
          where: { endedAt: inRange, endReason: SubscriptionEndReason.NOT_RENEWED },
        }),
        this.prisma.subscriptionCycle.count({ where: { status: CycleStatus.FAILED, attemptedAt: inRange } }),
      ]);
    const ended = cancelledByMember + cancelledByAdmin + expiredForPayment + expiredUnused;
    const running = await this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } });
    return {
      from: range.from,
      to: range.to,
      started,
      renewed,
      ended,
      cancelledByMember,
      cancelledByAdmin,
      expiredForPayment,
      expiredUnused,
      failedRenewals: failed,
      running,
      churnRate: started ? Number((ended / started).toFixed(4)) : 0,
    };
  }

  /** The member count and the Coin revenue of the last `days` days, for the dashboard cards. */
  async overview(days = 30) {
    const from = new Date(Date.now() - days * DAY_MS);
    const [members, activePlans, revenue] = await Promise.all([
      this.prisma.subscription.count({ where: { startedAt: { gte: from } } }),
      this.prisma.subscription.count({
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      }),
      this.revenue({ from, to: new Date() }),
    ]);
    return { windowDays: days, newSubscriptions: members, activePlans, revenue: revenue.totals };
  }
}
