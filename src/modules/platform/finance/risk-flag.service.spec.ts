import { ConflictException, NotFoundException } from '@nestjs/common';
import { financeOf } from './film-finance.service';
import { RiskFlagService } from './risk-flag.service';
import { RISK_RULES } from './risk-rules';

describe('financeOf (profit and ROI)', () => {
  const row = { movie_id: 'm1', title: 'Phim', project_status: 'COMPLETED', plan_vnd: 200n };

  it('nets refunds out of the unlock revenue and adds the Monthly-plan share', () => {
    const film = financeOf({ ...row, cost_vnd: 1000n, unlock_vnd: 1000n, refund_vnd: 100n });
    expect(film).toEqual(
      expect.objectContaining({
        unlockRevenueVnd: 900,
        revenueVnd: 1100,
        profitVnd: 100,
        roiPercent: 10,
        breakEven: true,
      }),
    );
  });

  it('has no ROI while no cost is recorded', () => {
    expect(financeOf({ ...row, cost_vnd: 0n, unlock_vnd: 0n, refund_vnd: 0n }).roiPercent).toBeNull();
  });
});

describe('RiskFlagService', () => {
  const tx = { transactionFlag: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() } };
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    transactionFlag: { createMany: jest.fn(), findUnique: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const service = new RiskFlagService(prisma as never, audit as never);
  const ADMIN = { id: 'admin', role: 'ADMIN' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('runs every rule and stores each hit once (duplicates skipped)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 't1', reason: 'Nạp 6000000 VND trong một lần' }]);
    prisma.transactionFlag.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.scan()).resolves.toEqual({ created: 1 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(RISK_RULES.length);
    expect(prisma.transactionFlag.createMany).toHaveBeenCalledWith({
      data: [{ coinTransactionId: 't1', ruleCode: 'LARGE_TOP_UP', reason: 'Nạp 6000000 VND trong một lần' }],
      skipDuplicates: true,
    });
  });

  it('lets the Admin dismiss an open flag with a note, audited', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce({ id: 'f1', status: 'OPEN', ruleCode: 'LARGE_TOP_UP' });
    tx.transactionFlag.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.review('f1', 'DISMISSED', ' Hợp lệ ', ADMIN);
    expect(tx.transactionFlag.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'OPEN' },
      data: expect.objectContaining({ status: 'DISMISSED', reviewNote: 'Hợp lệ', reviewedById: 'admin' }),
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRANSACTION_FLAG_REVIEWED' }), tx);
  });

  it('refuses an unknown flag and one already reviewed', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(null);
    await expect(service.review('x', 'CONFIRMED', undefined, ADMIN)).rejects.toThrow(NotFoundException);
    prisma.transactionFlag.findUnique.mockResolvedValueOnce({ id: 'f1', status: 'CONFIRMED' });
    await expect(service.review('f1', 'DISMISSED', undefined, ADMIN)).rejects.toThrow(ConflictException);
  });

  it('describes the rules for the Admin screen', () => {
    expect(service.rules().map((r) => r.code)).toEqual([
      'LARGE_TOP_UP',
      'LARGE_ADJUSTMENT',
      'RAPID_UNLOCKS',
      'REPEATED_REFUNDS',
    ]);
  });
});
