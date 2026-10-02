import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_ADMIN_PERMISSIONS,
  PERMISSION,
} from 'src/common/auth/permissions';
import { AccessControlService } from './access-control.service';

const rowsOf = (byRole: Partial<Record<UserRole, string[]>>) =>
  Object.entries(byRole).flatMap(([role, keys]) => keys.map((permissionKey) => ({ role, permissionKey })));

describe('AccessControlService', () => {
  const prisma = {
    rolePermission: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  let service: AccessControlService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.rolePermission.findMany.mockResolvedValue(rowsOf({ CONTENT_CREATOR: ['media:ingest'] }));
    service = new AccessControlService(prisma as unknown as PrismaService);
  });

  it('reads the role permissions once and serves them from memory afterwards', async () => {
    expect([...(await service.permissionsOf(UserRole.CONTENT_CREATOR))]).toEqual(['media:ingest']);
    expect((await service.permissionsOf(UserRole.MEMBER)).size).toBe(0);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(1);
  });

  it('replaces a role permission set and reloads it on the next check', async () => {
    await service.permissionsOf(UserRole.STAFF);
    prisma.rolePermission.findMany.mockResolvedValue(rowsOf({ STAFF: ['media:ingest'] }));

    const result = await service.setRolePermissions(UserRole.STAFF, ['media:ingest', 'media:ingest']);

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ role: 'STAFF', permissionKey: 'media:ingest' }],
    });
    expect(result.permissions).toEqual(['media:ingest']);
  });

  it('refuses unknown permissions and never lets ADMIN lose user or role management', async () => {
    await expect(service.setRolePermissions(UserRole.STAFF, ['films:delete'])).rejects.toThrow(BadRequestException);
    await expect(service.setRolePermissions(UserRole.ADMIN, [PERMISSION.USER_MANAGE])).rejects.toThrow('role:manage');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('caches the account state until the account is forgotten', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.STAFF, isActive: true });
    await service.accountState('u1');
    await service.accountState('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    service.forgetAccount('u1');
    await service.accountState('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('default permission matrix', () => {
  it('only uses catalogued keys and leaves the Admin able to manage roles', () => {
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(keys));
    }
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining(LOCKED_ADMIN_PERMISSIONS));
  });

  it('keeps the Admin out of editing projects (BR-55)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain(PERMISSION.PROJECT_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain(PERMISSION.EPISODE_PUBLISH);
  });
});
