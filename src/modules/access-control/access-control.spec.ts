import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_ADMIN_PERMISSIONS,
  PERMISSION,
} from 'src/common/auth/permissions';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/common/decorators/require-permission.decorator';
import { AccessControlService } from './access-control.service';
import { PermissionsGuard } from './permissions.guard';

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

describe('PermissionsGuard', () => {
  const accessControl = {
    accountState: jest.fn(),
    permissionsOf: jest.fn(),
  };
  const metadata: Record<string, unknown> = {};
  const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector, accessControl as unknown as AccessControlService);
  const contextFor = (user?: { id: string; role: UserRole }) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    delete metadata[IS_PUBLIC_KEY];
    metadata[PERMISSIONS_KEY] = [PERMISSION.CONTENT_REVIEW, PERMISSION.PROJECT_MANAGE];
    accessControl.accountState.mockResolvedValue({ role: UserRole.CONTENT_REVIEWER, isActive: true });
    accessControl.permissionsOf.mockResolvedValue(new Set([PERMISSION.PROJECT_MANAGE]));
  });

  it('lets through a role holding any one of the listed permissions', async () => {
    await expect(guard.canActivate(contextFor({ id: 'u1', role: UserRole.CONTENT_REVIEWER }))).resolves.toBe(true);
  });

  it('checks the role stored now, not the one frozen in the token', async () => {
    const user = { id: 'u1', role: UserRole.CONTENT_REVIEWER };
    accessControl.accountState.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: true });
    accessControl.permissionsOf.mockResolvedValue(new Set([PERMISSION.MEDIA_INGEST]));

    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(ForbiddenException);
    expect(user.role).toBe(UserRole.CONTENT_CREATOR);
  });

  it('shuts a locked account out even with a valid token', async () => {
    accessControl.accountState.mockResolvedValue({ role: UserRole.ADMIN, isActive: false });
    await expect(guard.canActivate(contextFor({ id: 'u1', role: UserRole.ADMIN }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('skips public endpoints without touching the database', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
    expect(accessControl.accountState).not.toHaveBeenCalled();
  });
});
