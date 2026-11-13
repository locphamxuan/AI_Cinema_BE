import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, ContractStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import type { ContractCompletionService } from './contract-completion.service';
import type { ContractSignatureService, PreparedSignature } from './contract-signature.service';
import { StudioContractService } from './contract-studio.service';

const ACTOR = { studioId: 's1', userId: 'studio-user' };
const SIGNED_AT = new Date('2026-11-10T06:00:00.000Z');
const PREPARED: PreparedSignature = {
  signedAt: SIGNED_AT,
  counterpart: {
    side: ContractDocumentSide.STUDIO,
    storageKey: 'contracts/p1/studio-k.pdf',
    fileName: 'hop-dong.pdf',
    sizeBytes: 512,
    checksum: 'b'.repeat(64),
  },
  final: null,
};

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  projectId: 'p1',
  studioId: 's1',
  handoffId: null,
  round: 1,
  costVnd: null,
  status: ContractStatus.SENT,
  terms: 'Điều khoản',
  adminSignedAt: null,
  adminSignedById: null,
  studioSignedAt: null,
  createdById: 'admin',
  project: { id: 'p1', status: 'ASSIGNED', reviewerId: 'rev', creatorId: 'cre', movie: { title: 'Phim' } },
  studio: { id: 's1', name: 'Studio A' },
  handoff: null,
  createdBy: { id: 'admin', fullName: 'Admin' },
  adminSignedBy: null,
  documents: [],
  ...overrides,
});

describe('StudioContractService', () => {
  const db = {
    contract: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const signatures = { prepare: jest.fn(), attach: jest.fn(), discard: jest.fn() };
  const completion = { complete: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn(), studioAccountIds: jest.fn() };
  const auditLog = { record: jest.fn() };
  const mails = { queue: jest.fn(), dispatch: jest.fn() };
  const service = new StudioContractService(
    prisma as unknown as PrismaService,
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
    notifications.studioAccountIds.mockResolvedValue(['studio-user']);
    db.contract.findUnique.mockResolvedValue({ id: 'c1', studioId: 's1', project: { status: 'ASSIGNED' } });
    signatures.prepare.mockResolvedValue(PREPARED);
    completion.complete.mockImplementation((_tx, id: string) => Promise.resolve(contract({ id, status: 'SIGNED' })));
  });

  it('fills in the cost and records the studio-signed PDF on the template', async () => {
    db.contract.findFirst.mockResolvedValue(contract());
    db.contract.findUniqueOrThrow
      .mockResolvedValueOnce(contract())
      .mockResolvedValue(contract({ status: ContractStatus.STUDIO_SIGNED, costVnd: 150_000_000n }));

    const proposed = await service.propose('c1', 150_000_000, ACTOR, file);

    expect(signatures.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ side: ContractDocumentSide.STUDIO, completes: false }),
      file,
      prisma,
    );
    expect(db.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ContractStatus.STUDIO_SIGNED, studioSignedAt: SIGNED_AT }),
      }),
    );
    expect(signatures.attach).toHaveBeenCalledWith(db, 'c1', PREPARED, 'studio-user');
    expect(proposed.status).toBe(ContractStatus.STUDIO_SIGNED);
    expect(completion.complete).not.toHaveBeenCalled();
  });

  it('never touches a round belonging to another studio', async () => {
    db.contract.findFirst.mockResolvedValue(null);
    await expect(service.propose('c1', 1_000, { studioId: 'other', userId: 'u' }, file)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(signatures.prepare).not.toHaveBeenCalled();
  });

  it("completes the contract when the studio signs the Admin's counter with its own PDF", async () => {
    const countered = contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 160_000_000n });
    db.contract.findFirst.mockResolvedValue(countered);
    db.contract.findUniqueOrThrow.mockResolvedValue(countered);
    signatures.prepare.mockResolvedValue({ ...PREPARED, final: { ...PREPARED.counterpart, side: 'FINAL' } });

    await service.studioSign('c1', ACTOR, file);

    expect(signatures.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ completes: true, costVnd: 160_000_000n }),
      file,
      prisma,
    );
    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SIGNED, studioSignedAt: SIGNED_AT },
    });
    expect(completion.complete).toHaveBeenCalledWith(db, 'c1', null, []);
  });

  it('refuses to sign a round the Admin has not countered, and only one side may answer a round', async () => {
    db.contract.findFirst.mockResolvedValue(contract({ status: ContractStatus.STUDIO_SIGNED }));
    await expect(service.studioSign('c1', ACTOR, file)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.propose('c1', 1_000, ACTOR, file)).rejects.toBeInstanceOf(ConflictException);
    expect(signatures.prepare).not.toHaveBeenCalled();
  });

  it("answers the Admin's counter with another price in a new round carrying the studio PDF", async () => {
    const countered = contract({ status: ContractStatus.ADMIN_COUNTERED, costVnd: 160_000_000n });
    db.contract.findFirst.mockResolvedValue(countered);
    db.contract.findUniqueOrThrow
      .mockResolvedValueOnce(countered)
      .mockResolvedValue(contract({ id: 'c3', round: 2, status: ContractStatus.STUDIO_SIGNED }));
    db.contract.create.mockResolvedValue(contract({ id: 'c3', round: 2, status: ContractStatus.STUDIO_SIGNED }));

    const next = await service.studioCounter('c1', 180_000_000, ACTOR, file);

    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ studioSignedAt: SIGNED_AT, round: 2 }) }),
    );
    expect(signatures.attach).toHaveBeenCalledWith(db, 'c3', PREPARED, 'studio-user');
    expect(next.status).toBe(ContractStatus.STUDIO_SIGNED);
    expect(completion.complete).not.toHaveBeenCalled();
    // The studio just acted: the Admin hears about it in the app, nothing is mailed back to the studio.
    expect(mails.queue).not.toHaveBeenCalled();
  });

  it('takes the stored PDF back when the transaction fails', async () => {
    db.contract.findFirst.mockResolvedValue(contract());
    db.contract.findUniqueOrThrow.mockResolvedValue(contract({ status: ContractStatus.SIGNED }));
    await expect(service.propose('c1', 1_000, ACTOR, file)).rejects.toBeInstanceOf(ConflictException);
    expect(signatures.discard).toHaveBeenCalledWith(PREPARED);
  });
});
