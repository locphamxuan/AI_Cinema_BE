import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { StudioAccountService } from './studio-account.service';

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const STUDIO_USER = { id: 'su1', role: UserRole.STUDIO };

describe('StudioAccountService', () => {
  const db = { user: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() } };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const auditLog = { record: jest.fn() };
  const service = new StudioAccountService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists only the studio's STUDIO accounts, oldest first", async () => {
    db.user.findMany.mockResolvedValue([]);
    await service.list('s1');
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studioId: 's1', role: UserRole.STUDIO }, orderBy: { createdAt: 'asc' } }),
    );
  });

  it('opens a STUDIO account with a normalized email and a hashed password, and audits it', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: 'su1', email: 'lumen@studio.vn' });

    await expect(
      service.create('s1', { email: '  Lumen@Studio.VN ', fullName: ' Lumen ', password: 'secret-123' }, ADMIN),
    ).resolves.toEqual({ id: 'su1', email: 'lumen@studio.vn' });

    const [{ data }] = db.user.create.mock.calls[0] as [
      { data: { email: string; fullName: string; role: UserRole; studioId: string; passwordHash: string } },
    ];
    expect(data).toMatchObject({ email: 'lumen@studio.vn', fullName: 'Lumen', role: UserRole.STUDIO, studioId: 's1' });
    await expect(bcrypt.compare('secret-123', data.passwordHash)).resolves.toBe(true);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.STUDIO_ACCOUNT_CREATED,
        entityType: 'Studio',
        entityId: 's1',
        actorId: 'admin',
        payload: { userId: 'su1', email: 'lumen@studio.vn' },
      }),
      db,
    );
  });

  it('refuses an email that already has an account', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-old' });
    await expect(
      service.create('s1', { email: 'taken@studio.vn', fullName: 'X', password: 'secret-123' }, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('resolves the studio a STUDIO caller speaks for, inside a transaction when given one', async () => {
    db.user.findUnique.mockResolvedValue({ studioId: 's1' });
    await expect(service.studioOf(STUDIO_USER)).resolves.toBe('s1');
    const tx = { user: { findUnique: jest.fn().mockResolvedValue({ studioId: 's2' }) } };
    await expect(service.studioOf(STUDIO_USER, tx as never)).resolves.toBe('s2');
  });

  it('refuses a non-studio role and a studio account with no studio', async () => {
    await expect(service.studioOf(ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    db.user.findUnique.mockResolvedValue({ studioId: null });
    await expect(service.studioOf(STUDIO_USER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
