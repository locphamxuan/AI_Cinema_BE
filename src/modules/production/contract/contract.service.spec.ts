import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, ContractStatus, ProjectStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import type { ContractCompletionService } from './contract-completion.service';
import type { ContractHandoffService } from './contract-handoff.service';
import type { ContractSignatureService, PreparedSignature } from './contract-signature.service';
import { ContractService } from './contract.service';

const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const PROJECT = { id: 'p1', reviewerId: 'rev', creatorId: 'cre', movie: { title: 'Phim' } };
const SIGNED_AT = new Date('2026-11-10T03:00:00.000Z');

const stored = (side: ContractDocumentSide) => ({
  side,
  storageKey: `contracts/p1/${side.toLowerCase()}-k.pdf`,
  fileName: 'hop-dong.pdf',
  sizeBytes: 1024,
  checksum: 'a'.repeat(64),
});

const prepared = (side: ContractDocumentSide, final = false): PreparedSignature => ({
  signedAt: SIGNED_AT,
  counterpart: stored(side),
  final: final ? stored(ContractDocumentSide.FINAL) : null,
});

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
  documents: [],
  ...overrides,
});

describe('ContractService', () => {
  const db = {
    movieProject: { findUniqueOrThrow: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
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
  const signatures = { prepare: jest.fn(), attach: jest.fn(), discard: jest.fn() };
  const completion = { complete: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn(), studioAccountIds: jest.fn() };
  const auditLog = { record: jest.fn() };
  const mails = { queue: jest.fn(), dispatch: jest.fn() };
  const service = new ContractService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    handoffs as unknown as ContractHandoffService,
    signatures as unknown as ContractSignatureService,
    completion as unknown as ContractCompletionService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
    mails as unknown as StudioMailService,
  );
  const file = { buffer: Buffer.from('%PDF-1.7'), originalname: 'ky.pdf', size: 8 } as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.adminIds.mockResolvedValue(['admin']);
    mails.queue.mockResolvedValue('m1');
    notifications.studioAccountIds.mockResolvedValue(['studio-user']);
    access.project.mockResolvedValue(PROJECT);
    db.user.findUniqueOrThrow.mockResolvedValue({ fullName: 'Nguyễn Văn A' });
    db.contract.findUnique.mockResolvedValue({ id: 'c1', studioId: 's1' });
    db.movieProject.findUniqueOrThrow.mockResolvedValue({ id: 'p1', studioId: 's1', status: ProjectStatus.ASSIGNED });
    completion.complete.mockImplementation((_tx, id: string) => Promise.resolve(contract({ id, status: 'SIGNED' })));
    signatures.prepare.mockResolvedValue(prepared(ContractDocumentSide.ADMIN, true));
  });

  it("sends the project's studio a template with no cost and tells the studio accounts", async () => {
    db.contract.count.mockResolvedValue(0);
    db.contract.create.mockResolvedValue(contract());
    await expect(service.sendTemplate(db as never, 'p1', 'admin')).resolves.toMatchObject({ mailId: 'm1' });
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
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.CONTRACT_SENT, entityId: 'c9', payload: { studioId: 's2' } }),
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

  it('completes the contract when the Admin uploads its signed PDF over the studio one', async () => {
    const round = contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 150_000_000n });
    db.contract.findUnique.mockResolvedValue(round);
    db.contract.findUniqueOrThrow.mockResolvedValue(round);

    await service.sign('c1', ADMIN, file);

    expect(signatures.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ side: ContractDocumentSide.ADMIN, completes: true, signerName: 'Nguyễn Văn A' }),
      file,
      prisma,
    );
    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SIGNED, adminSignedAt: SIGNED_AT, adminSignedById: 'admin' },
    });
    expect(signatures.attach).toHaveBeenCalledWith(db, 'c1', expect.objectContaining({ signedAt: SIGNED_AT }), 'admin');
    expect(completion.complete).toHaveBeenCalledWith(db, 'c1', 'admin', []);
    expect(mails.dispatch).toHaveBeenCalled();
  });

  it('leaves no stored PDF behind when the signing transaction fails', async () => {
    db.contract.findUnique.mockResolvedValue(contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 1_000n }));
    db.contract.findUniqueOrThrow.mockResolvedValue(contract({ status: ContractStatus.SENT }));

    await expect(service.sign('c1', ADMIN, file)).rejects.toThrow(ConflictException);

    expect(signatures.discard).toHaveBeenCalledWith(prepared(ContractDocumentSide.ADMIN, true));
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('refuses to countersign a round the studio has not signed, without storing anything', async () => {
    db.contract.findUnique.mockResolvedValue(contract());
    await expect(service.sign('c1', ADMIN, file)).rejects.toThrow(ConflictException);
    expect(signatures.prepare).not.toHaveBeenCalled();
  });

  it('404s a contract of a project the caller may not read', async () => {
    db.contract.findUnique.mockResolvedValue(null);
    await expect(service.sign('c9', ADMIN, file)).rejects.toBeInstanceOf(NotFoundException);
    db.contract.findUnique.mockResolvedValue(contract({ status: ContractStatus.STUDIO_SIGNED }));
    access.project.mockRejectedValue(new NotFoundException());
    await expect(service.sign('c1', ADMIN, file)).rejects.toBeInstanceOf(NotFoundException);
    expect(signatures.prepare).not.toHaveBeenCalled();
  });

  it('lets the Admin sign first: a signed offer straight on the unanswered template (demo order)', async () => {
    const template = contract({ status: ContractStatus.SENT, costVnd: null });
    const offer = contract({ id: 'c2', round: 2, status: ContractStatus.ADMIN_COUNTERED });
    db.contract.findUnique.mockResolvedValue(template);
    db.contract.findUniqueOrThrow.mockResolvedValueOnce(template).mockResolvedValue(offer);
    db.contract.create.mockResolvedValue(offer);
    signatures.prepare.mockResolvedValue(prepared(ContractDocumentSide.ADMIN));

    const next = await service.counter('c1', 150_000_000, ADMIN, file);

    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ContractStatus.ADMIN_COUNTERED }) }),
    );
    expect(next.status).toBe(ContractStatus.ADMIN_COUNTERED);
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('refuses a signed offer on a round that is already signed by both sides', async () => {
    db.contract.findUnique.mockResolvedValue(contract({ status: ContractStatus.SIGNED }));
    await expect(service.counter('c1', 150_000_000, ADMIN, file)).rejects.toThrow(ConflictException);
    expect(signatures.prepare).not.toHaveBeenCalled();
  });

  it('counters within the budget, opening a new round with the Admin-signed PDF on it', async () => {
    const round = contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 200_000_000n });
    db.contract.findUnique.mockResolvedValue(round);
    db.contract.findUniqueOrThrow
      .mockResolvedValueOnce(round)
      .mockResolvedValue(contract({ id: 'c2', round: 2, status: ContractStatus.ADMIN_COUNTERED }));
    db.contract.create.mockResolvedValue(contract({ id: 'c2', round: 2, status: ContractStatus.ADMIN_COUNTERED }));
    signatures.prepare.mockResolvedValue(prepared(ContractDocumentSide.ADMIN));

    const next = await service.counter('c1', 160_000_000, ADMIN, file);

    expect(signatures.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ completes: false, costVnd: 160_000_000n }),
      file,
      prisma,
    );
    expect(handoffs.assertAffordable).toHaveBeenCalledWith(db, 'p1', 160_000_000, null);
    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ adminSignedAt: SIGNED_AT, round: 2 }) }),
    );
    expect(signatures.attach).toHaveBeenCalledWith(db, 'c2', expect.anything(), 'admin');
    expect(next.round).toBe(2);
    expect(completion.complete).not.toHaveBeenCalled();
    expect(mails.dispatch).toHaveBeenCalledWith('m1');
  });

  it('tells whether a hand-off has a signed round', async () => {
    db.contract.count.mockResolvedValue(1);
    await expect(service.isSigned('h1')).resolves.toBe(true);
  });
});
