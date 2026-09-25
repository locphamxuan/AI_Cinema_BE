import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PERMISSION } from 'src/common/auth/permissions';
import type { AccessControlService } from 'src/modules/access-control/access-control.service';
import { UserService } from './user.service';

describe('UserService.update', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const forgetAccount = jest.fn();
  const accessControl = {
    forgetAccount,
    permissionsOf: () => Promise.resolve(new Set([PERMISSION.USER_MANAGE])),
  } as unknown as AccessControlService;
  const service = new UserService(prisma as unknown as PrismaService, accessControl);
  const admin = { id: 'admin-id', email: 'admin@aicinema.com', role: UserRole.ADMIN };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
  });

  it('changes the role and makes the next request see it', async () => {
    await service.update('u1', { role: UserRole.STAFF }, admin);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { role: UserRole.STAFF, isActive: undefined } }),
    );
    const [{ select }] = prisma.user.update.mock.calls[0] as [{ select: Record<string, boolean> }];
    expect(select).not.toHaveProperty('passwordHash');
    expect(forgetAccount).toHaveBeenCalledWith('u1');
  });

  it('never lets an Admin demote or lock their own account', async () => {
    await expect(service.update('admin-id', { role: UserRole.MEMBER }, admin)).rejects.toThrow(BadRequestException);
    await expect(service.update('admin-id', { isActive: false }, admin)).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
