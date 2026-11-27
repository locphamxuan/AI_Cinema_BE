import { FilmFinanceService, financeOf, totalsOf } from './film-finance.service';

const row = (over: Partial<Parameters<typeof financeOf>[0]> = {}) => ({
  movie_id: 'm1',
  title: 'Mưa Sài Gòn',
  studio_name: 'Studio A',
  created_at: new Date('2026-10-01T00:00:00Z'),
  cost_vnd: 0n,
  sales_vnd: 0n,
  refund_vnd: 0n,
  plan_vnd: 0n,
  ...over,
});

describe('financeOf', () => {
  it('takes refunds off episode sales and adds the Monthly-plan share to the revenue', () => {
    const film = financeOf(
      row({ cost_vnd: 150_000_000n, sales_vnd: 92_000_000n, refund_vnd: 2_000_000n, plan_vnd: 30_000_000n }),
    );
    expect(film).toMatchObject({
      episodeSalesVnd: 90_000_000,
      refundedVnd: 2_000_000,
      planShareVnd: 30_000_000,
      revenueVnd: 120_000_000,
      profitVnd: -30_000_000,
      breakEven: 'NOT_YET',
      studioName: 'Studio A',
    });
  });

  it('calls a film without production cost NO_COST, never broken even', () => {
    expect(financeOf(row())).toMatchObject({ profitVnd: 0, breakEven: 'NO_COST' });
    expect(financeOf(row({ sales_vnd: 5_000n })).breakEven).toBe('NO_COST');
  });

  it('marks a film whose revenue covers its cost as broken even', () => {
    expect(financeOf(row({ cost_vnd: 10_000_000n, sales_vnd: 15_000_000n }))).toMatchObject({
      profitVnd: 5_000_000,
      breakEven: 'BROKE_EVEN',
    });
  });
});

describe('totalsOf', () => {
  it('sums both revenue sources, gives the margin over revenue', () => {
    const films = [
      financeOf(row({ cost_vnd: 150_000_000n, sales_vnd: 92_000_000n, refund_vnd: 2_000_000n, plan_vnd: 30_000_000n })),
      financeOf(row({ movie_id: 'm2' })),
      financeOf(row({ movie_id: 'm3', cost_vnd: 10_000_000n, sales_vnd: 15_000_000n })),
    ];
    expect(totalsOf(films)).toEqual({
      productionCostVnd: 160_000_000,
      episodeSalesVnd: 105_000_000,
      planShareVnd: 30_000_000,
      revenueVnd: 135_000_000,
      profitVnd: -25_000_000,
      marginPercent: -18.52,
      costedMovies: 2,
      brokeEvenMovies: 1,
    });
  });

  it('has no margin while nothing was spent or earned', () => {
    expect(totalsOf([])).toMatchObject({ marginPercent: null, costedMovies: 0 });
  });
});

describe('FilmFinanceService', () => {
  it('reports the running month and the last month already shared', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([row({ cost_vnd: 1_000n })]),
      revenueAllocation: { findFirst: jest.fn().mockResolvedValue({ period: '2026-10' }) },
    };
    const report = await new FilmFinanceService(prisma as never).films(new Date('2026-11-22T03:00:00Z'));
    expect(report).toMatchObject({ currentPeriod: '2026-11', lastSharedPeriod: '2026-10' });
    expect(report.films).toHaveLength(1);
    expect(prisma.revenueAllocation.findFirst).toHaveBeenCalledWith({
      orderBy: { period: 'desc' },
      select: { period: true },
    });
  });

  it('has no shared month before the first allocation', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      revenueAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const report = await new FilmFinanceService(prisma as never).films();
    expect(report.lastSharedPeriod).toBeNull();
    expect(report.totals.revenueVnd).toBe(0);
  });
});
