import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfig } from 'src/config/app-config';
import { JwtAuthGuard } from './jwt-auth.guard';

const config = { jwt: { issuer: 'ai-cinema', audience: 'ai-cinema-api' } } as unknown as AppConfig;

function contextFor(authorization?: string) {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { authorization },
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  const jwt = { verifyAsync: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(jwt as unknown as JwtService, reflector as unknown as Reflector, config);

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  it('lets an anonymous caller through a public route', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context, request } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('refuses a protected route without a bearer token', async () => {
    await expect(guard.canActivate(contextFor().context)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(contextFor('Basic abc').context)).rejects.toThrow(UnauthorizedException);
  });

  it('verifies the token with the pinned algorithm, issuer and audience and sets the caller', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      role: 'STUDIO',
      type: 'access',
      scope: 'studio.portal  profile',
      studio_id: 's1',
    });
    const { context, request } = contextFor('Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('good', {
      algorithms: ['HS256'],
      issuer: 'ai-cinema',
      audience: 'ai-cinema-api',
    });
    expect(request.user).toEqual({ id: 'u1', role: 'STUDIO', scopes: ['studio.portal', 'profile'], studioId: 's1' });
  });

  it('refuses an invalid token on a protected route but ignores it on a public one', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('expired'));
    await expect(guard.canActivate(contextFor('Bearer bad').context)).rejects.toThrow('Invalid or expired token');

    reflector.getAllAndOverride.mockReturnValue(true);
    const { context, request } = contextFor('Bearer bad');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('refuses a token that is not an access token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'MEMBER', type: 'refresh' });

    await expect(guard.canActivate(contextFor('Bearer r').context)).rejects.toThrow(
      'This token cannot be used to call the API',
    );
  });
});
