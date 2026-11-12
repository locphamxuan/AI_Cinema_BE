import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OAuthClient } from '@prisma/client';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { hashRefreshToken, newRefreshToken } from 'src/modules/identity/auth/credentials';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { TokenRequestDto } from './dto/oauth.request.dto';
import { type ClientCredentials, OAuthClientService } from './oauth-client.service';
import { OAuthError, OAUTH_ERROR } from './oauth-error';
import { rolesForScopes } from './oauth-scopes';
import { hashAuthorizationCode, verifyPkce } from './pkce';

const DAY_MS = 24 * 60 * 60 * 1000;

/** RFC 6749 §5.1. */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const invalidGrant = (description: string) => new OAuthError(OAUTH_ERROR.INVALID_GRANT, description);

/**
 * The token endpoint (RFC 6749 §4.1.3, §6) and revocation (RFC 7009). An access token issued here carries
 * its scopes and the studio it speaks for, so OAuthScopeGuard keeps it inside the studio portal and drops
 * it the moment the account leaves that studio. Refresh tokens rotate, are bound to the client, and a
 * replayed code or refresh token revokes everything that client holds for the account (RFC 9700 §4.14).
 */
@Injectable()
export class OAuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: OAuthClientService,
    private readonly jwt: JwtService,
    private readonly audit: AuditLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async token(dto: TokenRequestDto, credentials: ClientCredentials): Promise<TokenResponse> {
    const client = await this.clients.authenticate(credentials);
    if (dto.grant_type === 'authorization_code') return this.exchangeCode(client, dto);
    if (dto.grant_type === 'refresh_token') return this.refresh(client, dto.refresh_token);
    throw new OAuthError(OAUTH_ERROR.UNSUPPORTED_GRANT_TYPE, 'Unsupported grant_type');
  }

  /** RFC 7009 §2.2: the answer is 200 whether or not the token was known, so it leaks nothing. */
  async revoke(token: string, credentials: ClientCredentials): Promise<void> {
    const client = await this.clients.authenticate(credentials);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(token), oauthClientId: client.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async exchangeCode(client: OAuthClient, dto: TokenRequestDto): Promise<TokenResponse> {
    if (!dto.code || !dto.redirect_uri || !dto.code_verifier) {
      throw new OAuthError(OAUTH_ERROR.INVALID_REQUEST, 'code, redirect_uri and code_verifier are required');
    }
    const row = await this.prisma.authorizationCode.findUnique({
      where: { codeHash: hashAuthorizationCode(dto.code) },
    });
    if (!row || row.clientId !== client.id) throw invalidGrant('Unknown authorization code');
    if (row.usedAt) return this.replayed(client, row.userId, 'code');
    if (row.expiresAt <= new Date()) throw invalidGrant('The authorization code expired');
    if (row.redirectUri !== dto.redirect_uri) throw invalidGrant('redirect_uri does not match the authorization');
    if (!verifyPkce(dto.code_verifier, row.codeChallenge, row.codeChallengeMethod)) {
      throw invalidGrant('code_verifier does not match the code_challenge');
    }
    // Single use under concurrency: only the request that stamps usedAt first gets tokens.
    const { count } = await this.prisma.authorizationCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return this.replayed(client, row.userId, 'code');

    const studioId = await this.assertStillAllowed(row.userId, row.scope);
    const issued = await this.issue(client, row.userId, row.scope, studioId);
    await this.audit.record({
      action: CONTENT_EVENT.OAUTH_TOKEN_ISSUED,
      entityType: 'OAuthClient',
      entityId: client.id,
      projectId: null,
      actorId: row.userId,
      payload: { clientId: client.clientId, scope: row.scope, studioId },
    });
    return issued;
  }

  private async refresh(client: OAuthClient, refreshToken: string | undefined): Promise<TokenResponse> {
    if (!refreshToken) throw new OAuthError(OAUTH_ERROR.INVALID_REQUEST, 'refresh_token is required');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (!stored || stored.oauthClientId !== client.id || !stored.scope) throw invalidGrant('Unknown refresh token');
    if (stored.revokedAt) return this.replayed(client, stored.userId, 'refresh_token');
    if (stored.expiresAt <= new Date()) throw invalidGrant('The refresh token expired');

    const studioId = await this.assertStillAllowed(stored.userId, stored.scope);
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return this.replayed(client, stored.userId, 'refresh_token');
    const issued = await this.issue(client, stored.userId, stored.scope, studioId);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedBy: { connect: { tokenHash: hashRefreshToken(issued.refresh_token) } } },
    });
    return issued;
  }

  /**
   * The grant is only as good as the account behind it right now: still active, still in the role the
   * scope needs, and — for a studio — still tied to an active studio. Answers that studio.
   */
  private async assertStillAllowed(userId: string, scope: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true, studioId: true, studio: { select: { isActive: true } } },
    });
    if (!user?.isActive || !rolesForScopes(scope.split(' ')).includes(user.role)) {
      throw invalidGrant('The account can no longer use this grant');
    }
    if (user.studioId && !user.studio?.isActive) throw invalidGrant('The studio of this account is not active');
    return user.studioId ?? undefined;
  }

  private async issue(client: OAuthClient, userId: string, scope: string, studioId?: string): Promise<TokenResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const refreshToken = newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlDays * DAY_MS),
        oauthClientId: client.id,
        scope,
      },
    });
    const payload: AccessTokenPayload = {
      sub: userId,
      role: user.role,
      type: 'access',
      scope,
      ...(studioId ? { studio_id: studioId } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      algorithm: JWT_ALGORITHM,
      expiresIn: this.config.jwt.accessTtlSeconds,
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.config.jwt.accessTtlSeconds,
      refresh_token: refreshToken,
      scope,
    };
  }

  /** RFC 9700 §2.2.2 / §4.14: a replay means the grant leaked; the client's sessions for the account end. */
  private async replayed(client: OAuthClient, userId: string, what: 'code' | 'refresh_token'): Promise<never> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, oauthClientId: client.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: CONTENT_EVENT.OAUTH_CODE_REPLAYED,
      entityType: 'OAuthClient',
      entityId: client.id,
      projectId: null,
      actorId: null,
      payload: { clientId: client.clientId, userId, replayed: what },
    });
    throw invalidGrant(`This ${what === 'code' ? 'authorization code' : 'refresh token'} was already used`);
  }
}
