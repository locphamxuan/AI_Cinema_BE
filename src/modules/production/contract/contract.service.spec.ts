import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractStatus, ProjectStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import type { ContractHandoffService } from './contract-handoff.service';
import { ContractService } from './contract.service';

const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const PROJECT = { id: 'p1', reviewerId: 'rev', creatorId: 'cre', movie: { title: 'Phim' } };

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  projectId: 'p1',
  studioId: 's1',
  handoffId: null,
  round: 1,
  previousId: null,
  costVnd: null,
  proposedBy: null,
  status: ContractStatus.SENT,
  terms: 'Điều khoản',
  adminSignedAt: null,
  adminSignedById: null,
  studioSignedAt: null,
  createdById: 'admin',
  project: PROJECT,
  studio: { id: 's1', name: 'Studio A' },
  handoff: null,
  createdBy: { id: 'admin', fullName: 'Admin' },
  adminSignedBy: null,
  ...overrides,
});

describe('ContractService', () => {
  const db = {
    movieProject: { findUniqueOrThrow: jest.fn() },
    contract: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const handoffs = { open: jest.fn(), assertAffordable: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn(), studioAccountIds: jest.fn() };
  const auditLog = { record: jest.fn() };
  const mails = { queue: jest.fn(), dispatch: jest.fn() };
  const service = new ContractService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    handoffs as unknown as ContractHandoffService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
    mails as unknown as StudioMailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.adminIds.mockResolvedValue(['admin']);
    mails.queue.mockResolvedValue('m1');
    notifications.studioAccountIds.mockResolvedValue(['studio-user']);
    access.project.mockResolvedValue(PROJECT);
    db.contract.findUnique.mockResolvedValue({ id: 'c1', studioId: 's1' });
    db.movieProject.findUniqueOrThrow.mockResolvedValue({ id: 'p1', studioId: 's1', status: ProjectStatus.ASSIGNED });
  });

  it("sends the project's studio a template with no cost and tells the studio accounts", async () => {
    db.contract.count.mockResolvedValue(0);
    db.contract.create.mockResolvedValue(contract());
    await expect(service.sendTemplate(db as never, 'p1', 'admin')).resolves.toMatchObject({ mailId: 'm1' });
    expect(mails.queue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ studioId: 's1', senderId: 'admin', portalPath: '/contracts' }),
    );
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', studioId: 's1' }) }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      ['studio-user'],
      expect.objectContaining({ link: '/contracts' }),
      db,
    );
  });

  it('supersedes the open rounds and sends the new studio a template tied to its waiting hand-off', async () => {
    db.contract.create.mockResolvedValue(contract({ id: 'c9', studioId: 's2', handoffId: 'h2' }));
    notifications.studioAccountIds.mockResolvedValue(['new-studio-user']);

    const sent = await service.sendForStudioChange(db as never, {
      projectId: 'p1',
      studioId: 's2',
      handoffId: 'h2',
      actorId: 'admin',
    });

    expect(sent.id).toBe('c9');
    expect(db.contract.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        status: { in: [ContractStatus.SENT, ContractStatus.STUDIO_SIGNED, ContractStatus.ADMIN_COUNTERED] },
      },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(db.contract.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.contract.create.mock.invocationCallOrder[0],
    );
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'p1', studioId: 's2', handoffId: 'h2', createdById: 'admin' }),
      }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.CONTRACT_SENT, entityId: 'c9', payload: { studioId: 's2' } }),
      db,
    );
    expect(notifications.studioAccountIds).toHaveBeenCalledWith('s2', db);
    expect(notifications.notify).toHaveBeenCalledWith(
      ['new-studio-user'],
      expect.objectContaining({ link: '/contracts' }),
      db,
    );
    // The studio change emails the brief itself, so no second invitation goes out here.
    expect(mails.queue).not.toHaveBeenCalled();
  });

  it('refuses a second contract and a project without a studio', async () => {
    db.contract.count.mockResolvedValue(1);
    await expect(service.sendTemplate(db as never, 'p1', 'admin')).rejects.toThrow(ConflictException);
    db.movieProject.findUniqueOrThrow.mockResolvedValue({ id: 'p1', studioId: null, status: ProjectStatus.ASSIGNED });
    await expect(service.sendTemplate(db as never, 'p1', 'admin')).rejects.toThrow(/studio/);
  });

  it('lets the studio fill in the cost of its own template only', async () => {
    db.contract.findUniqueOrThrow
      .mockResolvedValueOnce(contract())
      .mockResolvedValueOnce(contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 150_000_000n }));
    const proposed = await service.propose('c1', 150_000_000, 's1');
    expect(proposed.status).toBe(ContractStatus.STUDIO_SIGNED);
    expect(db.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ContractStatus.STUDIO_SIGNED }) }),
    );
    await expect(service.propose('c1', 1_000, 'other-studio')).rejects.toThrow(NotFoundException);
  });

  it('signs as Admin and hands the project off', async () => {
    const signed = contract({ status: ContractStatus.SIGNED, costVnd: 150_000_000n, adminSignedById: 'admin' });
    db.contract.findUniqueOrThrow
      .mockResolvedValueOnce(contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 150_000_000n }))
      .mockResolvedValue(signed);
    await service.sign('c1', ADMIN);
    expect(handoffs.open).toHaveBeenCalledWith(db, signed);
    expect(mails.queue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ senderId: 'admin', portalPath: '/projects/p1' }),
    );
    expect(mails.dispatch).toHaveBeenCalledWith('m1');
  });

  it('counters within the budget, opening a new round signed by the Admin', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValueOnce(
      contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 200_000_000n }),
    );
    db.contract.create.mockResolvedValue(contract({ id: 'c2', round: 2, status: ContractStatus.ADMIN_COUNTERED }));
    const next = await service.counter('c1', 160_000_000, ADMIN);
    expect(handoffs.assertAffordable).toHaveBeenCalledWith(db, 'p1', 160_000_000, null);
    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(next.round).toBe(2);
    expect(mails.dispatch).toHaveBeenCalledWith('m1');
  });

  it('refuses to countersign a round the studio has not signed', async () => {
    db.contract.findUniqueOrThrow.mockResolvedValueOnce(contract());
    await expect(service.sign('c1', ADMIN)).rejects.toThrow(ConflictException);
  });

  it("lets the studio sign the Admin's counter, completing the contract", async () => {
    const countered = contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 160_000_000n });
    db.contract.findUniqueOrThrow.mockResolvedValueOnce(countered).mockResolvedValue({
      ...countered,
      status: ContractStatus.SIGNED,
    });
    await service.studioSign('c1', 's1');
    expect(handoffs.open).toHaveBeenCalled();
  });

  it("answers the Admin's counter with another price in a new round", async () => {
    db.contract.findUniqueOrThrow.mockResolvedValueOnce(
      contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 160_000_000n }),
    );
    db.contract.create.mockResolvedValue(contract({ id: 'c3', round: 3, status: ContractStatus.STUDIO_SIGNED }));
    const next = await service.studioCounter('c1', 180_000_000, 's1');
    expect(next.status).toBe(ContractStatus.STUDIO_SIGNED);
    expect(handoffs.open).not.toHaveBeenCalled();
    // The studio just acted: the Admin hears about it in the app, nothing is mailed back to the studio.
    expect(mails.queue).not.toHaveBeenCalled();
  });

  it('tells whether a hand-off has a signed round', async () => {
    db.contract.count.mockResolvedValue(1);
    await expect(service.isSigned('h1')).resolves.toBe(true);
  });
});
