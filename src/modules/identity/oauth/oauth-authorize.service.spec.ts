import { UserRole } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OAuthAuthorizeService } from './oauth-authorize.service';
import { OAuthClientService } from './oauth-client.service';
import { OAuthError } from './oauth-error';

const CLIENT = {
  id: 'c-uuid',
  clientId: 'studio-web',
  name: 'Studio Web',
  redirectUris: ['http://localhost:3100/api/auth/callback'],
  scopes: ['studio:portal'],
  clientSecretHash: null,
  isEnabled: true,
};
const QUERY = {
  response_type: 'code',
  client_id: 'studio-web',
  redirect_uri: 'http://localhost:3100/api/auth/callback',
  scope: 'studio:portal',
  state: 'xyz',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
};
const STUDIO = { id: 'u-studio', role: UserRole.STUDIO };

describe('OAuthAuthorizeService', () => {
  const prisma = {
    oAuthClient: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    authorizationCode: { create: jest.fn() },
  };
  const config = { oauth: { codeTtlSeconds: 60 } } as unknown as AppConfig;
  const service = new OAuthAuthorizeService(
    prisma as unknown as PrismaService,
    new OAuthClientService(prisma as unknown as PrismaService),
    config,
  );
  const codeOf = (error: unknown) => (error as OAuthError).code;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.oAuthClient.findUnique.mockResolvedValue(CLIENT);
    prisma.user.findUnique.mockResolvedValue({ studio: { name: 'Lumen Studio', isActive: true } });
  });

  it('describes the consent screen for a studio account', async () => {
    const view = await service.describe(STUDIO, QUERY);
    expect(view.client).toEqual({ clientId: 'studio-web', name: 'Studio Web' });
    expect(view.account.studioName).toBe('Lumen Studio');
    expect(view.scopes[0].scope).toBe('studio:portal');
  });

  it('refuses an unregistered redirect_uri as JSON, never as a redirect', async () => {
    const err = await service
      .describe(STUDIO, { ...QUERY, redirect_uri: 'https://evil.example/cb' })
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe('invalid_request');
  });

  it('refuses an unknown client, a missing PKCE, a foreign scope and another response_type', async () => {
    prisma.oAuthClient.findUnique.mockResolvedValueOnce(null);
    expect(codeOf(await service.describe(STUDIO, QUERY).catch((e: unknown) => e))).toBe('invalid_client');
    expect(
      codeOf(await service.describe(STUDIO, { ...QUERY, code_challenge_method: 'plain' }).catch((e: unknown) => e)),
    ).toBe('invalid_request');
    expect(codeOf(await service.describe(STUDIO, { ...QUERY, scope: 'admin' }).catch((e: unknown) => e))).toBe(
      'invalid_scope',
    );
    expect(codeOf(await service.describe(STUDIO, { ...QUERY, response_type: 'token' }).catch((e: unknown) => e))).toBe(
      'unsupported_response_type',
    );
  });

  it('refuses a non-studio account and a studio account of an inactive studio', async () => {
    const admin = { id: 'u-admin', role: UserRole.ADMIN };
    expect(codeOf(await service.describe(admin, QUERY).catch((e: unknown) => e))).toBe('access_denied');
    prisma.user.findUnique.mockResolvedValue({ studio: { name: 'Old', isActive: false } });
    expect(codeOf(await service.describe(STUDIO, QUERY).catch((e: unknown) => e))).toBe('access_denied');
  });

  it('issues a one-minute code bound to the challenge and redirects with code and state', async () => {
    const { redirectTo } = await service.decide(STUDIO, { ...QUERY, approve: true });
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe(QUERY.redirect_uri);
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const calls = prisma.authorizationCode.create.mock.calls as [{ data: Record<string, unknown> }][];
    const { data } = calls[0][0];
    expect(data).toMatchObject({ clientId: 'c-uuid', userId: 'u-studio', codeChallenge: QUERY.code_challenge });
    expect(data.codeHash).not.toBe(url.searchParams.get('code'));
  });

  it('redirects a refusal with access_denied and issues nothing', async () => {
    const { redirectTo } = await service.decide(STUDIO, { ...QUERY, approve: false });
    expect(new URL(redirectTo).searchParams.get('error')).toBe('access_denied');
    expect(prisma.authorizationCode.create).not.toHaveBeenCalled();
  });
});
