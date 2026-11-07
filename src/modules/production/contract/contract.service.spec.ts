import { ConflictException } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ContractService } from './contract.service';

const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const PROJECT = { id: 'p1', reviewerId: 'rev', creatorId: 'cre', movie: { title: 'Phim' } };
const HANDOFF = { id: 'h1', milestoneStatus: 'BRIEF_SENT', studio: { id: 's1', name: 'Studio A' } };

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  projectId: 'p1',
  handoffId: 'h1',
  round: 1,
  previousId: null,
  costVnd: null,
  proposedBy: null,
  status: ContractStatus.SENT,
  terms: 'Điều khoản',
  adminSignedAt: null,
  adminSignedById: null,
  studioSignedAt: null,
  createdById: 'rev',
  project: PROJECT,
  handoff: HANDOFF,
  createdBy: { id: 'rev', fullName: 'Reviewer' },
  adminSignedBy: null,
  ...overrides,
});

describe('ContractService', () => {
  const db = {
    contract: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    studioHandoff: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ContractService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.adminIds.mockResolvedValue(['admin']);
    access.project.mockResolvedValue(PROJECT);
    db.studioHandoff.findFirst.mockResolvedValue(HANDOFF);
    db.contract.findUnique.mockResolvedValue({ id: 'c1' });
  });

  it('sends a template with no cost, once per hand-off', async () => {
    db.contract.findFirst.mockResolvedValue(null);
    db.contract.create.mockResolvedValue(contract());

    await service.create('p1', 'h1', undefined, ADMIN);

    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', handoffId: 'h1' }) as unknown }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.arrayContaining(['rev', 'cre', 'admin']),
      expect.objectContaining({ type: 'CONTRACT_UPDATED' }),
      db,
    );

    db.contract.findFirst.mockResolvedValue(contract({ status: ContractStatus.SENT }));
    await expect(service.create('p1', 'h1', undefined, ADMIN)).rejects.toThrow(ConflictException);
  });

  it('lets the studio fill in the cost and sign a freshly sent template', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValue(contract());

    await service.propose('c1', 170_000_000);

    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        costVnd: 170_000_000n,
        proposedBy: 'STUDIO',
        status: ContractStatus.STUDIO_SIGNED,
      }) as unknown,
    });
  });

  it('refuses to fill in a template that already moved on', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValue(contract({ status: ContractStatus.STUDIO_SIGNED }));
    await expect(service.propose('c1', 170_000_000)).rejects.toThrow(ConflictException);
  });

  it('lets Admin countersign the cost the studio proposed, completing the contract', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValue(
      contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 170_000_000n, proposedBy: 'STUDIO' }),
    );

    await service.sign('c1', ADMIN);

    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: ContractStatus.SIGNED, adminSignedById: 'admin' }) as unknown,
    });
  });

  it('refuses to sign a contract the studio has not proposed yet', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValue(contract({ status: ContractStatus.SENT }));
    await expect(service.sign('c1', ADMIN)).rejects.toThrow(ConflictException);
  });

  it('opens a new, countersigned round when Admin disagrees with the cost', async () => {
    const current = contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 170_000_000n, proposedBy: 'STUDIO' });
    db.contract.findUniqueOrThrow.mockResolvedValue(current);
    db.contract.create.mockResolvedValue(
      contract({ id: 'c2', round: 2, previousId: 'c1', status: ContractStatus.ADMIN_COUNTERED }),
    );

    const next = await service.counter('c1', 150_000_000, ADMIN);

    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          round: 2,
          previousId: 'c1',
          costVnd: 150_000_000n,
          proposedBy: 'ADMIN',
          status: ContractStatus.ADMIN_COUNTERED,
          adminSignedById: 'admin',
        }) as unknown,
      }),
    );
    expect(next.id).toBe('c2');
  });

  it('completes the contract when the studio signs what Admin countered', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValue(
      contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 150_000_000n }),
    );

    await service.studioSign('c1');

    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: ContractStatus.SIGNED }) as unknown,
    });
  });

  it('opens a new round when the studio counters what Admin proposed', async () => {
    const current = contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 150_000_000n, proposedBy: 'ADMIN' });
    db.contract.findUniqueOrThrow.mockResolvedValue(current);
    db.contract.create.mockResolvedValue(
      contract({ id: 'c3', round: 2, previousId: 'c1', status: ContractStatus.STUDIO_SIGNED }),
    );

    await service.studioCounter('c1', 160_000_000);

    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          costVnd: 160_000_000n,
          proposedBy: 'STUDIO',
          status: ContractStatus.STUDIO_SIGNED,
        }) as unknown,
      }),
    );
  });

  it('reports whether a hand-off has a fully signed round', async () => {
    db.contract.count.mockResolvedValue(1);
    await expect(service.isSigned('h1')).resolves.toBe(true);

    db.contract.count.mockResolvedValue(0);
    await expect(service.isSigned('h1')).resolves.toBe(false);
  });
});
