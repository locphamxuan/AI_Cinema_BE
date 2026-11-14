import { BadRequestException, ConflictException } from '@nestjs/common';
import { periodOf, periodRange, previousPeriod } from './finance-period';
import { RevenueAllocationService, splitPool } from './revenue-allocation.service';

describe('finance periods (Vietnam time)', () => {
  it('maps a month to its Vietnam midnights', () => {
    const { from, to } = periodRange('2026-10');
    expect(from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('refuses a malformed period', () => {
    expect(() => periodRange('2026-13')).toThrow(BadRequestException);
  });

  it('knows the current and previous month across a year boundary', () => {
    const newYearInVietnam = new Date('2025-12-31T18:00:00Z');
    expect(periodOf(newYearInVietnam)).toBe('2026-01');
    expect(previousPeriod(newYearInVietnam)).toBe('2025-12');
  });
});

describe('splitPool (BR-48)', () => {
  it('shares by watch seconds and hands the rounding loss to the largest remainders', () => {
    const shares = splitPool(100n, [
      { movieId: 'a', seconds: 1n },
      { movieId: 'b', seconds: 1n },
      { movieId: 'c', seconds: 1n },
    ]);
    expect(shares.map((s) => s.allocatedVnd)).toEqual([34n, 33n, 33n]);
    expect(shares.reduce((sum, s) => sum + s.allocatedVnd, 0n)).toBe(100n);
  });

  it('gives nothing when nobody watched or nothing was paid', () => {
    expect(splitPool(100n, [{ movieId: 'a', seconds: 0n }])[0].allocatedVnd).toBe(0n);
    expect(splitPool(0n, [{ movieId: 'a', seconds: 50n }])[0].allocatedVnd).toBe(0n);
  });
});

describe('RevenueAllocationService', () => {
  const tx = { revenueAllocation: { deleteMany: jest.fn(), createMany: jest.fn() } };
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    revenueAllocation: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const service = new RevenueAllocationService(prisma as never, audit as never);
  const NOW = new Date('2026-11-14T03:00:00Z');

  beforeEach(() => jest.clearAllMocks());

  it('replaces the rows of the month with the new shares and audits the run', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ vnd: 1_000_000n }]).mockResolvedValueOnce([
      { movie_id: 'm1', seconds: 300n },
      { movie_id: 'm2', seconds: 100n },
    ]);
    await service.allocate('2026-10', 'admin', NOW);
    expect(tx.revenueAllocation.deleteMany).toHaveBeenCalledWith({ where: { period: '2026-10' } });
    expect(tx.revenueAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ movieId: 'm1', allocatedVnd: 750_000n, totalWatchSeconds: 400n }),
        expect.objectContaining({ movieId: 'm2', allocatedVnd: 250_000n, monthlyPoolVnd: 1_000_000n }),
      ],
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'REVENUE_ALLOCATED' }), tx);
  });

  it('refuses the current month, which is not over yet', async () => {
    await expect(service.allocate('2026-11', 'admin', NOW)).rejects.toThrow(ConflictException);
  });

  it('lets the scheduler allocate a month only once', async () => {
    prisma.revenueAllocation.count.mockResolvedValueOnce(3);
    await expect(service.allocateIfMissing('2026-10', NOW)).resolves.toBe(false);
    prisma.revenueAllocation.count.mockResolvedValueOnce(0);
    prisma.$queryRaw.mockResolvedValueOnce([{ vnd: null }]);
    await expect(service.allocateIfMissing('2026-10', NOW)).resolves.toBe(false);
    expect(tx.revenueAllocation.createMany).not.toHaveBeenCalled();
  });
});
