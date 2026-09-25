import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION } from 'src/common/auth/permissions';
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
    prisma.rolePermission.findMany.mockResolvedValue(rowsOf({ CONTENT_CREATOR: ['production:read'] }));
    service = new AccessControlService(prisma as unknown as PrismaService);
  });

  it('reads the role permissions once and serves them from memory afterwards', async () => {
    expect([...(await service.permissionsOf(UserRole.CONTENT_CREATOR))]).toEqual(['production:read']);
    expect((await service.permissionsOf(UserRole.MEMBER)).size).toBe(0);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(1);
  });

  it('replaces a role permission set and reloads it on the next check', async () => {
    await service.permissionsOf(UserRole.STAFF);
    prisma.rolePermission.findMany.mockResolvedValue(rowsOf({ STAFF: ['production:read'] }));

    const result = await service.setRolePermissions(UserRole.STAFF, ['production:read', 'production:read']);

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ role: 'STAFF', permissionKey: 'production:read' }],
    });
    expect(result.permissions).toEqual(['production:read']);
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

  it('seeds the database with exactly the default matrix kept in code', () => {
    const dir = join(__dirname, '../../../prisma/migrations/20260925160000_add_role_permissions/migration.sql');
    const sql = readFileSync(dir, 'utf8');
    const seeded = [...sql.matchAll(/\('([A-Z_]+)', '([a-z-]+:[a-z.-]+)'\)/g)].map(([, role, key]) => `${role} ${key}`);
    const inCode = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, keys]) => keys.map((k) => `${role} ${k}`));
    expect(seeded.sort()).toEqual(inCode.sort());
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
    metadata[PERMISSIONS_KEY] = [PERMISSION.PLAN_REVIEW, PERMISSION.PROJECT_MANAGE];
    accessControl.accountState.mockResolvedValue({ role: UserRole.CONTENT_REVIEWER, isActive: true });
    accessControl.permissionsOf.mockResolvedValue(new Set([PERMISSION.PROJECT_MANAGE]));
  });

  it('lets through a role holding any one of the listed permissions', async () => {
    await expect(guard.canActivate(contextFor({ id: 'u1', role: UserRole.CONTENT_REVIEWER }))).resolves.toBe(true);
  });

  it('checks the role stored now, not the one frozen in the token', async () => {
    const user = { id: 'u1', role: UserRole.CONTENT_REVIEWER };
    accessControl.accountState.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: true });
    accessControl.permissionsOf.mockResolvedValue(new Set([PERMISSION.PLAN_WRITE]));

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
