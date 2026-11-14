import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionCostEntryType, ProjectStatus, StudioMilestoneStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProductionCostService } from './production-cost.service';

const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const PROJECT = { id: 'p1', status: ProjectStatus.ASSIGNED, reviewerId: 'reviewer', movie: { title: 'Phim' } };

describe('ProductionCostService', () => {
  const db = {
    $queryRaw: jest.fn(),
    productionCostEntry: { aggregate: jest.fn(), count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    studioHandoff: { findMany: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ProductionCostService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  /** A project whose ledger sums to `budget`, with one live hand-off of `committed`. */
  function state(budget: number, committed = 0, funded = budget > 0) {
    db.productionCostEntry.aggregate.mockResolvedValue({ _sum: { amountVnd: BigInt(budget) } });
    db.productionCostEntry.count.mockResolvedValue(funded ? 1 : 0);
    db.studioHandoff.findMany.mockResolvedValue(
      committed
        ? [{ milestoneStatus: StudioMilestoneStatus.IN_PROGRESS, offeredFeeVnd: BigInt(committed), forfeitedVnd: 0n }]
        : [],
    );
    db.productionCostEntry.create.mockResolvedValue({ id: 'entry' });
    db.productionCostEntry.findMany.mockResolvedValue([]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
  });

  it('sets the budget once and tells the Reviewer', async () => {
    state(0);
    await service.addEntry('p1', { entryType: ProductionCostEntryType.BUDGET, amountVnd: 150_000_000 }, ADMIN);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.productionCostEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entryType: 'BUDGET', amountVnd: 150_000_000n, createdById: 'admin' }) as unknown,
    });
    expect(notifications.notify).toHaveBeenCalledWith(['reviewer'], expect.anything(), db);

    state(150_000_000);
    await expect(
      service.addEntry('p1', { entryType: ProductionCostEntryType.BUDGET, amountVnd: 1000 }, ADMIN),
    ).rejects.toThrow(ConflictException);
  });

  it('needs a budget and a reason before a correction', async () => {
    state(0);
    const cut = { entryType: ProductionCostEntryType.CORRECTION, amountVnd: -1000, reason: 'Sai số' } as const;
    await expect(service.addEntry('p1', cut, ADMIN)).rejects.toThrow(ConflictException);
    state(10_000);
    await expect(service.addEntry('p1', { ...cut, reason: '  ' }, ADMIN)).rejects.toThrow(BadRequestException);
  });

  it('never corrects the budget below what is committed to studios', async () => {
    state(100_000_000, 80_000_000);
    const cut = (amountVnd: number) =>
      service.addEntry('p1', { entryType: ProductionCostEntryType.CORRECTION, amountVnd, reason: 'Cắt giảm' }, ADMIN);
    await expect(cut(-30_000_000)).rejects.toThrow(BadRequestException);
    await expect(cut(-20_000_000)).resolves.toBeDefined();
  });

  it('refuses a fee above the budget left', async () => {
    state(100_000_000, 80_000_000);
    await expect(service.assertAffordable(db as never, 'p1', 20_000_000)).resolves.toBeUndefined();
    await expect(service.assertAffordable(db as never, 'p1', 21_000_000)).rejects.toThrow(ConflictException);
  });
});
