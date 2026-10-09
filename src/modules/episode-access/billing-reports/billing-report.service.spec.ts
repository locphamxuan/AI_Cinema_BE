import { CycleStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { BillingReportService } from './billing-report.service';

describe('BillingReportService.revenue', () => {
  const prisma = {
    subscription: { count: jest.fn() },
    subscriptionCycle: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new BillingReportService(prisma as unknown as PrismaService);
  const range = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T00:00:00.000Z') };

  const cycles = [
    {
      priceCoins: 900,
      mainCoinsCharged: 900,
      bonusCoinsCharged: 0,
      attemptedAt: new Date('2026-10-05T00:00:00.000Z'),
      subscription: { plan: { id: 'p1', code: 'MONTHLY', name: 'Monthly' } },
    },
    {
      priceCoins: 900,
      mainCoinsCharged: 10,
      bonusCoinsCharged: 890,
      attemptedAt: new Date('2026-10-06T00:00:00.000Z'),
      subscription: { plan: { id: 'p1', code: 'MONTHLY', name: 'Monthly' } },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.subscriptionCycle.findMany.mockResolvedValue(cycles);
  });

  it('counts only PAID cycles, bonus Coins never as revenue twice', async () => {
    const report = await service.revenue(range);

    expect(prisma.subscriptionCycle.findMany).toHaveBeenCalledWith({
      where: { status: CycleStatus.PAID, attemptedAt: { gte: range.from, lte: range.to } },
      select: expect.anything(),
    });
    expect(report.totals).toEqual({ paidCycles: 2, coins: 1800, mainCoins: 910, bonusCoins: 890 });
    expect(report.byPlan).toEqual([
      {
        plan: { id: 'p1', code: 'MONTHLY', name: 'Monthly' },
        cycles: 2,
        coins: 1800,
        mainCoins: 910,
        bonusCoins: 890,
      },
    ]);
  });

  it('ranks plans by Coins, richest first', async () => {
    prisma.subscriptionCycle.findMany.mockResolvedValue([
      { ...cycles[0], subscription: { plan: { id: 'p-small', code: 'S', name: 'S' } } },
      {
        ...cycles[0],
        priceCoins: 100,
        mainCoinsCharged: 100,
        subscription: { plan: { id: 'p-big', code: 'B', name: 'B' } },
      },
    ]);

    const report = await service.revenue(range);
    expect(report.byPlan.map((row) => row.plan)).toEqual([
      { id: 'p-small', code: 'S', name: 'S' },
      { id: 'p-big', code: 'B', name: 'B' },
    ]);
  });
});

describe('BillingReportService.revenueByDay', () => {
  const prisma = {
    subscription: { count: jest.fn() },
    subscriptionCycle: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new BillingReportService(prisma as unknown as PrismaService);
  const range = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T00:00:00.000Z') };

  it('buckets the chart by calendar day, oldest first', async () => {
    prisma.subscriptionCycle.findMany.mockResolvedValue([
      { attemptedAt: new Date('2026-10-05T01:00:00.000Z'), mainCoinsCharged: 900, bonusCoinsCharged: 0 },
      { attemptedAt: new Date('2026-10-05T23:00:00.000Z'), mainCoinsCharged: 100, bonusCoinsCharged: 0 },
      { attemptedAt: new Date('2026-10-06T12:00:00.000Z'), mainCoinsCharged: 10, bonusCoinsCharged: 890 },
    ]);

    await expect(service.revenueByDay(range)).resolves.toEqual([
      { date: '2026-10-05', cycles: 2, mainCoins: 1000, bonusCoins: 0 },
      { date: '2026-10-06', cycles: 1, mainCoins: 10, bonusCoins: 890 },
    ]);
  });
});

describe('BillingReportService.churn', () => {
  const prisma = {
    subscription: { count: jest.fn() },
    subscriptionCycle: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new BillingReportService(prisma as unknown as PrismaService);
  const range = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T00:00:00.000Z') };

  it('counts a churned member only once the plan really ends', async () => {
    prisma.subscription.count
      .mockResolvedValueOnce(100) // started
      .mockResolvedValueOnce(2) // cancelled by member
      .mockResolvedValueOnce(1) // cancelled by admin
      .mockResolvedValueOnce(3) // expired for payment
      .mockResolvedValueOnce(4) // expired unused
      .mockResolvedValueOnce(90); // running
    prisma.subscriptionCycle.count
      .mockResolvedValueOnce(80) // renewed
      .mockResolvedValueOnce(5); // failed

    const churn = await service.churn(range);

    expect(churn).toMatchObject({
      started: 100,
      renewed: 80,
      ended: 10,
      failedRenewals: 5,
      running: 90,
      churnRate: 0.1,
    });
  });

  it('reports a zero rate when nobody started', async () => {
    prisma.subscription.count.mockResolvedValue(0);
    prisma.subscriptionCycle.count.mockResolvedValue(0);

    await expect(service.churn(range)).resolves.toMatchObject({ started: 0, churnRate: 0 });
  });
});

describe('BillingReportService.overview', () => {
  const prisma = {
    subscription: { count: jest.fn() },
    subscriptionCycle: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new BillingReportService(prisma as unknown as PrismaService);

  it('packs the dashboard cards into one answer', async () => {
    prisma.subscription.count.mockResolvedValueOnce(7).mockResolvedValueOnce(50);
    prisma.subscriptionCycle.findMany.mockResolvedValue([]);

    const overview = await service.overview(7);

    expect(overview).toMatchObject({ windowDays: 7, newSubscriptions: 7, activePlans: 50 });
    expect(overview.revenue).toMatchObject({ paidCycles: 0, coins: 0 });
  });
});
