import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERMISSION } from 'src/common/auth/permissions';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/common/decorators/require-permission.decorator';
import { AccessControlService } from './access-control.service';
import { PermissionsGuard } from './permissions.guard';

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
