import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PERMISSION } from 'src/common/auth/permissions';
import type { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import type { SessionTokenService } from 'src/modules/identity/auth/session-token.service';
import { UserService } from './user.service';

describe('UserService.update', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const sessions = { revokeAll: jest.fn() };
  const forgetAccount = jest.fn();
  const accessControl = {
    forgetAccount,
    permissionsOf: () => Promise.resolve(new Set([PERMISSION.USER_MANAGE])),
  } as unknown as AccessControlService;
  const service = new UserService(
    prisma as unknown as PrismaService,
    accessControl,
    sessions as unknown as SessionTokenService,
  );
  const admin = { id: 'admin-id', role: UserRole.ADMIN };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.CONTENT_CREATOR });
  });

  it('changes the role and makes the next request see it', async () => {
    await service.update('u1', { role: UserRole.STAFF }, admin);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: UserRole.STAFF, isActive: undefined } }),
    );
    const [{ select }] = prisma.user.update.mock.calls[0] as [{ select: Record<string, boolean> }];
    expect(select).not.toHaveProperty('passwordHash');
    expect(forgetAccount).toHaveBeenCalledWith('u1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('signs a locked account out of every session', async () => {
    await service.update('u1', { isActive: false }, admin);
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('keeps the sessions when nothing security-relevant changes', async () => {
    await service.update('u1', { role: UserRole.CONTENT_CREATOR, isActive: true }, admin);
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('never lets an Admin demote or lock their own account', async () => {
    await expect(service.update('admin-id', { role: UserRole.MEMBER }, admin)).rejects.toThrow(BadRequestException);
    await expect(service.update('admin-id', { isActive: false }, admin)).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('UserService.remove', () => {
  const count = () => jest.fn().mockResolvedValue(0);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'm1' }), delete: jest.fn() },
    coinTransaction: { count: count() },
    episodeAccess: { count: count() },
    dailyCheckIn: { count: count() },
    rewardSpin: { count: count() },
  };
  const accessControl = { forgetAccount: jest.fn() } as unknown as AccessControlService;
  const service = new UserService(prisma as unknown as PrismaService, accessControl, {} as SessionTokenService);
  const admin = { id: 'admin-id', role: UserRole.ADMIN };

  beforeEach(() => jest.clearAllMocks());

  it('deletes a member whose only Coin move is the automatic welcome bonus', async () => {
    await service.remove('m1', admin);
    expect(prisma.coinTransaction.count).toHaveBeenCalledWith({
      where: { wallet: { userId: 'm1' }, entryType: { not: 'SIGNUP_BONUS' } },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it.each(['coinTransaction', 'episodeAccess', 'dailyCheckIn', 'rewardSpin'] as const)(
    'keeps an account with %s rows, so the Coin ledger is never cascaded away',
    async (table) => {
      prisma[table].count.mockResolvedValueOnce(1);
      await expect(service.remove('m1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    },
  );
});
