import { CodeChallengeMethod, UserRole } from '@prisma/client';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { hashRefreshToken } from 'src/modules/identity/auth/credentials';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { OAuthClientService, credentialsFromBasic } from './oauth-client.service';
import { OAuthError } from './oauth-error';
import { OAuthTokenService } from './oauth-token.service';
import { hashAuthorizationCode } from './pkce';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://localhost:3100/api/auth/callback';
const CLIENT = { id: 'c-uuid', clientId: 'studio-web', isEnabled: true, clientSecretHash: null };
const CREDS = { clientId: 'studio-web' };

describe('OAuthTokenService', () => {
  const prisma = {
    oAuthClient: { findUnique: jest.fn() },
    authorizationCode: { findUnique: jest.fn(), updateMany: jest.fn() },
    refreshToken: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const jwt = { signAsync: jest.fn() };
  const audit = { record: jest.fn() };
  const config = {
    jwt: { accessTtlSeconds: 900, refreshTtlDays: 30, issuer: 'iss', audience: 'aud' },
  } as unknown as AppConfig;
  const service = new OAuthTokenService(
    prisma as unknown as PrismaService,
    new OAuthClientService(prisma as unknown as PrismaService),
    jwt as unknown as JwtService,
    audit as unknown as AuditLogService,
    config,
  );
  const codeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'code-1',
    clientId: 'c-uuid',
    userId: 'u-studio',
    scope: 'studio:portal',
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: CodeChallengeMethod.S256,
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  });
  const exchange = {
    grant_type: 'authorization_code' as const,
    code: 'the-code',
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
  };
  const errorOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as OAuthError).code;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.oAuthClient.findUnique.mockResolvedValue(CLIENT);
    prisma.authorizationCode.findUnique.mockResolvedValue(codeRow());
    prisma.authorizationCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.STUDIO,
      isActive: true,
      studioId: 'studio-1',
      studio: { isActive: true },
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ role: UserRole.STUDIO });
    jwt.signAsync.mockResolvedValue('signed.jwt');
  });

  it('exchanges a code with the right verifier for scoped, studio-bound tokens', async () => {
    const res = await service.token(exchange, CREDS);
    expect(res).toMatchObject({
      access_token: 'signed.jwt',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'studio:portal',
    });
    expect(prisma.authorizationCode.findUnique).toHaveBeenCalledWith({
      where: { codeHash: hashAuthorizationCode('the-code') },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u-studio', scope: 'studio:portal', studio_id: 'studio-1', type: 'access' }),
      expect.anything(),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ oauthClientId: 'c-uuid', scope: 'studio:portal' }),
    });
  });

  it('refuses a wrong verifier, another redirect_uri and an expired code', async () => {
    expect(await errorOf(service.token({ ...exchange, code_verifier: 'x'.repeat(43) }, CREDS))).toBe('invalid_grant');
    expect(await errorOf(service.token({ ...exchange, redirect_uri: 'http://other/cb' }, CREDS))).toBe('invalid_grant');
    prisma.authorizationCode.findUnique.mockResolvedValue(codeRow({ expiresAt: new Date(Date.now() - 1) }));
    expect(await errorOf(service.token(exchange, CREDS))).toBe('invalid_grant');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('treats a second use of a code as a replay and revokes what the client holds for the account', async () => {
    prisma.authorizationCode.findUnique.mockResolvedValue(codeRow({ usedAt: new Date() }));
    expect(await errorOf(service.token(exchange, CREDS))).toBe('invalid_grant');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-studio', oauthClientId: 'c-uuid', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'OAUTH_CODE_REPLAYED' }));
  });

  it('loses the race for a code like a replay', async () => {
    prisma.authorizationCode.updateMany.mockResolvedValue({ count: 0 });
    expect(await errorOf(service.token(exchange, CREDS))).toBe('invalid_grant');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('refuses a code of another client and an account that left its studio meanwhile', async () => {
    prisma.authorizationCode.findUnique.mockResolvedValue(codeRow({ clientId: 'other' }));
    expect(await errorOf(service.token(exchange, CREDS))).toBe('invalid_grant');
    prisma.authorizationCode.findUnique.mockResolvedValue(codeRow());
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.STUDIO,
      isActive: true,
      studioId: 's',
      studio: { isActive: false },
    });
    expect(await errorOf(service.token(exchange, CREDS))).toBe('invalid_grant');
  });

  it('rotates a refresh token of this client and refuses a reused one', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-studio',
      oauthClientId: 'c-uuid',
      scope: 'studio:portal',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.token({ grant_type: 'refresh_token', refresh_token: 'r' }, CREDS)).resolves.toMatchObject({
      scope: 'studio:portal',
    });
    expect(prisma.refreshToken.update).toHaveBeenCalled();

    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-studio',
      oauthClientId: 'c-uuid',
      scope: 'studio:portal',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await errorOf(service.token({ grant_type: 'refresh_token', refresh_token: 'r' }, CREDS))).toBe(
      'invalid_grant',
    );
  });

  it('never refreshes a plain-login token at the OAuth endpoint', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt', userId: 'u', oauthClientId: null, scope: null });
    expect(await errorOf(service.token({ grant_type: 'refresh_token', refresh_token: 'r' }, CREDS))).toBe(
      'invalid_grant',
    );
  });

  it('requires client authentication, with the secret when the client has one', async () => {
    expect(await errorOf(service.token(exchange, {}))).toBe('invalid_client');
    prisma.oAuthClient.findUnique.mockResolvedValue({ ...CLIENT, clientSecretHash: '$2b$12$invalidinvalidinvalidinv' });
    expect(await errorOf(service.token(exchange, { clientId: 'studio-web', clientSecret: 'nope' }))).toBe(
      'invalid_client',
    );
  });

  it('revokes only a refresh token of the calling client', async () => {
    await service.revoke('r', CREDS);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashRefreshToken('r'), oauthClientId: 'c-uuid', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('reads client_secret_basic credentials', () => {
    const header = `Basic ${Buffer.from('studio-web:s%3Acret').toString('base64')}`;
    expect(credentialsFromBasic(header)).toEqual({ clientId: 'studio-web', clientSecret: 's:cret' });
    expect(credentialsFromBasic('Bearer x')).toEqual({});
  });
});
