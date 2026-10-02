import { BadRequestException, ConflictException } from '@nestjs/common';
import { MovieStatus, TokenEntryType, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProductionFeeService } from './production-fee.service';

describe('ProductionFeeService.addEntry', () => {
  const reviewer = { id: 'reviewer-1', role: UserRole.CONTENT_REVIEWER };
  const tx = {
    $queryRaw: jest.fn(),
    tokenLedgerEntry: { aggregate: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'entry-1' }) },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    tokenLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = { movie: jest.fn() };
  const settings = { get: jest.fn().mockResolvedValue({ tokenRateVnd: 1000 }) };
  const auditLog = { record: jest.fn() };
  const service = new ProductionFeeService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    settings as unknown as PlatformSettingService,
    auditLog as unknown as AuditLogService,
  );

  const withState = (status: MovieStatus, total: number) => {
    access.movie.mockResolvedValue({ id: 'm1', status });
    tx.tokenLedgerEntry.aggregate.mockResolvedValue({ _sum: { amountTokens: BigInt(total) } });
  };

  beforeEach(() => jest.clearAllMocks());

  it('allocates the initial fee of a draft at the current Token rate and logs it', async () => {
    withState(MovieStatus.DRAFT, 0);
    await service.addEntry('m1', { entryType: TokenEntryType.INITIAL, amountTokens: 50000 }, reviewer);

    expect(tx.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountTokens: 50000n, rateVnd: 1000, entryType: TokenEntryType.INITIAL }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'FEE_ALLOCATED' }), tx);
  });

  it('allows a single initial allocation, only on a draft', async () => {
    withState(MovieStatus.DRAFT, 100);
    await expect(service.addEntry('m1', { entryType: 'INITIAL', amountTokens: 10 }, reviewer)).rejects.toThrow(
      ConflictException,
    );
    withState(MovieStatus.ASSIGNED, 0);
    await expect(service.addEntry('m1', { entryType: 'INITIAL', amountTokens: 10 }, reviewer)).rejects.toThrow(
      ConflictException,
    );
  });

  it('needs a reason for top-ups and corrections (BR-46)', async () => {
    withState(MovieStatus.IN_PRODUCTION, 100);
    await expect(service.addEntry('m1', { entryType: 'TOP_UP', amountTokens: 10 }, reviewer)).rejects.toThrow(
      BadRequestException,
    );
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
