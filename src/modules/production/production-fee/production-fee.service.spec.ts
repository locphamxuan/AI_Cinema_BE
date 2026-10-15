import { BadRequestException, ConflictException } from '@nestjs/common';
import { MovieStatus, TokenEntryType, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { ReviewerTokenService } from 'src/modules/production/reviewer-token/reviewer-token.service';
import { ProductionFeeService } from './production-fee.service';

describe('ProductionFeeService.addEntry', () => {
  const reviewer = { id: 'reviewer-1', role: UserRole.CONTENT_REVIEWER };
  const tx = {
    $queryRaw: jest.fn(),
    season: { findFirst: jest.fn() },
    tokenLedgerEntry: {
      aggregate: jest.fn(),
      count: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    tokenLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
    season: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = { movie: jest.fn() };
  const settings = { get: jest.fn().mockResolvedValue({ tokenRateVnd: 1000 }) };
  const auditLog = { record: jest.fn() };
  const budgets = { assertCanSpend: jest.fn(), notifyAllocation: jest.fn() };
  const service = new ProductionFeeService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    settings as unknown as PlatformSettingService,
    auditLog as unknown as AuditLogService,
    budgets as unknown as ReviewerTokenService,
  );

  const withState = (status: MovieStatus, total: number) => {
    access.movie.mockResolvedValue({ id: 'm1', status });
    tx.tokenLedgerEntry.aggregate.mockResolvedValue({ _sum: { amountTokens: BigInt(total) } });
  };
  const withSeason = (cost: bigint, episodes: number, allocated = 0) => {
    tx.season.findFirst.mockResolvedValue({ id: 's1', episodeProductionCost: cost, _count: { episodes } });
    tx.tokenLedgerEntry.count.mockResolvedValue(allocated);
  };
  const initial = { entryType: TokenEntryType.INITIAL, seasonId: 's1' };

  beforeEach(() => jest.clearAllMocks());

  it('allocates a season as episode price × episodes at the current Token rate and logs it', async () => {
    withState(MovieStatus.DRAFT, 0);
    withSeason(5000n, 4);
    await service.addEntry('m1', initial, reviewer);

    expect(budgets.assertCanSpend).toHaveBeenCalledWith(tx, 'reviewer-1', 20000);
    expect(tx.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seasonId: 's1',
        amountTokens: 20000n,
        rateVnd: 1000,
        entryType: TokenEntryType.INITIAL,
      }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_ALLOCATED' }), tx);
  });

  it('ignores the amount a client sends for a season allocation', async () => {
    withState(MovieStatus.DRAFT, 0);
    withSeason(100n, 3);
    await service.addEntry('m1', { ...initial, amountTokens: 1 }, reviewer);
    expect(tx.tokenLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amountTokens: 300n }) });
  });

  it('allocates each season once, only while the project is open, and needs the season and its price', async () => {
    withState(MovieStatus.DRAFT, 100);
    withSeason(5000n, 4, 1);
    await expect(service.addEntry('m1', initial, reviewer)).rejects.toThrow(ConflictException);

    withSeason(0n, 4);
    await expect(service.addEntry('m1', initial, reviewer)).rejects.toThrow('episode price');
    withSeason(5000n, 0);
    await expect(service.addEntry('m1', initial, reviewer)).rejects.toThrow('no episode');
    await expect(service.addEntry('m1', { entryType: 'INITIAL' }, reviewer)).rejects.toThrow(BadRequestException);

    withState(MovieStatus.COMPLETED, 0);
    withSeason(5000n, 4);
    await expect(service.addEntry('m1', initial, reviewer)).rejects.toThrow(ConflictException);
    expect(tx.tokenLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('refuses a season of another project', async () => {
    withState(MovieStatus.DRAFT, 0);
    tx.season.findFirst.mockResolvedValue(null);
    await expect(service.addEntry('m1', initial, reviewer)).rejects.toThrow('does not belong');
  });

  it('needs a reason for top-ups and corrections (BR-46)', async () => {
    withState(MovieStatus.IN_PRODUCTION, 100);
    await expect(service.addEntry('m1', { entryType: 'TOP_UP', amountTokens: 10 }, reviewer)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('ties a top-up to its season', async () => {
    withState(MovieStatus.IN_PRODUCTION, 100);
    withSeason(5000n, 4, 1);
    await service.addEntry(
      'm1',
      { entryType: 'TOP_UP', seasonId: 's1', amountTokens: 5000, reason: 'Two more episodes' },
      reviewer,
    );
    expect(tx.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ seasonId: 's1', amountTokens: 5000n, entryType: TokenEntryType.TOP_UP }),
    });
  });

  it('never lets a correction bring the fee to zero or below', async () => {
    withState(MovieStatus.IN_PRODUCTION, 100);
    const correction = (amountTokens: number) =>
      service.addEntry('m1', { entryType: 'CORRECTION', amountTokens, reason: 'typo' }, reviewer);
    await expect(correction(-100)).rejects.toThrow(BadRequestException);
    await expect(correction(0)).rejects.toThrow(BadRequestException);
    await expect(correction(-40)).resolves.toBeDefined();
  });

  it('refuses any change once the project is closed', async () => {
    withState(MovieStatus.COMPLETED, 100);
    await expect(
      service.addEntry('m1', { entryType: 'TOP_UP', amountTokens: 10, reason: 'late invoice' }, reviewer),
    ).rejects.toThrow(ConflictException);
    expect(tx.tokenLedgerEntry.create).not.toHaveBeenCalled();
  });
});
