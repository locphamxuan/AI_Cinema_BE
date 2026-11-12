import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/common/decorators/require-permission.decorator';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OAUTH_OPEN_KEY, OAuthScopeGuard } from './oauth-scope.guard';

describe('OAuthScopeGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const reflector = new Reflector();
  const guard = new OAuthScopeGuard(reflector, prisma as unknown as PrismaService);

  const context = (user: AuthenticatedUser | undefined, metadata: Record<string, unknown> = {}): ExecutionContext => {
    const handler = () => undefined;
    for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  };
  const studioToken: AuthenticatedUser = {
    id: 'u-studio',
    role: UserRole.STUDIO,
    scopes: ['studio:portal'],
    studioId: 'studio-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ studioId: 'studio-1', studio: { isActive: true } });
  });

  it('never limits a plain login token', async () => {
    await expect(
      guard.canActivate(context({ id: 'a', role: UserRole.ADMIN }, { [PERMISSIONS_KEY]: ['user:manage'] })),
    ).resolves.toBe(true);
  });

  it('lets a studio token call the studio portal', async () => {
    await expect(guard.canActivate(context(studioToken, { [PERMISSIONS_KEY]: ['studio:portal'] }))).resolves.toBe(true);
  });

  it('refuses a studio token anywhere its scopes do not open, even with no permission named', async () => {
    await expect(
      guard.canActivate(context(studioToken, { [PERMISSIONS_KEY]: ['episode:publish'] })),
    ).rejects.toMatchObject({
      code: 'insufficient_scope',
    });
    await expect(guard.canActivate(context(studioToken))).rejects.toMatchObject({ code: 'insufficient_scope' });
  });

  it('opens the routes marked OAuthOpen and the public ones', async () => {
    await expect(guard.canActivate(context(studioToken, { [OAUTH_OPEN_KEY]: true }))).resolves.toBe(true);
    await expect(guard.canActivate(context(studioToken, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });

  it('drops a token once the account moved studio or the studio was deactivated', async () => {
    prisma.user.findUnique.mockResolvedValue({ studioId: 'studio-2', studio: { isActive: true } });
    await expect(
      guard.canActivate(context(studioToken, { [PERMISSIONS_KEY]: ['studio:portal'] })),
    ).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    prisma.user.findUnique.mockResolvedValue({ studioId: 'studio-1', studio: { isActive: false } });
    await expect(
      guard.canActivate(context(studioToken, { [PERMISSIONS_KEY]: ['studio:portal'] })),
    ).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});
