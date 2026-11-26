import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { hashRefreshToken, newRefreshToken } from './credentials';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

/**
 * Short-lived access JWTs and rotating refresh tokens. Each refresh replaces the token it
 * used; presenting a token that was already replaced means it leaked, so every session of
 * that account is revoked.
 */
/** How long after a swap the old refresh token may still be retried once (its answer was lost on the way). */
export const REUSE_GRACE_MS = 60_000;

/** One answer for an unknown, expired, signed-out or locked-account refresh token. */
function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Invalid or expired refresh token',
    details: { reason: 'REFRESH_TOKEN_INVALID' },
  });
}

@Injectable()
export class SessionTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(user: Pick<User, 'id' | 'role'>): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: this.refreshExpiry() },
    });
    return { accessToken: await this.signAccess(user), refreshToken, accessTokenExpiresIn: this.accessTtl };
  }

  /** Swaps a valid refresh token for a new pair; returns the account it belongs to. */
  async rotate(refreshToken: string, retry = true): Promise<{ userId: string; tokens: TokenPair }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });
    if (!stored) throw invalidRefreshToken();
    // A token the OAuth endpoint issued keeps its scopes; swapping it here would drop them.
    if (stored.oauthClientId) throw invalidRefreshToken();
    // A retry of a refresh whose answer never reached the app (weak network, app sent to the background) comes right
    // after the swap: it carries on from the token that replaced it. Any later reuse still reads as theft.
    const retried =
      stored.revokedAt && stored.replacedById && Date.now() - stored.revokedAt.getTime() <= REUSE_GRACE_MS;
    if (retried && stored.expiresAt > new Date() && stored.user.isActive) {
      return { userId: stored.userId, tokens: await this.swap(stored.replacedById!, stored.user) };
    }
    // Only a token that was swapped for another one can be replayed by a thief. A token revoked by a sign-out,
    // a password change or a lock has no successor: a stale app presenting it must not sign out every device.
    if (stored.revokedAt && !stored.replacedById) throw invalidRefreshToken();
    if (stored.revokedAt) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException({
        message: 'This refresh token was already used; every session has been signed out',
        details: { reason: 'REFRESH_TOKEN_REUSED' },
      });
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) throw invalidRefreshToken();

    try {
      return { userId: stored.userId, tokens: await this.swap(stored.id, stored.user) };
    } catch (error) {
      // Two refreshes of the same token at once: the loser reads it again and carries on from the winner's swap.
      if (retry && error instanceof UnauthorizedException) return this.rotate(refreshToken, false);
      throw error;
    }
  }

  /** Replaces one live refresh token with a new pair; only the request that revokes it first wins a double refresh. */
  private async swap(tokenId: string, user: Pick<User, 'id' | 'role'>): Promise<TokenPair> {
    const next = newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId: user.id, tokenHash: hashRefreshToken(next), expiresAt: this.refreshExpiry() },
      });
      const { count } = await tx.refreshToken.updateMany({
        where: { id: tokenId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      if (count === 0) throw invalidRefreshToken();
    });
    return { accessToken: await this.signAccess(user), refreshToken: next, accessTokenExpiresIn: this.accessTtl };
  }

  /** Signs out the session of this refresh token; unknown tokens are ignored. */
  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs the account out everywhere (password change, lock, role change, token theft). */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private get accessTtl(): number {
    return this.config.jwt.accessTtlSeconds;
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.jwt.refreshTtlDays * DAY_MS);
  }

  private signAccess(user: Pick<User, 'id' | 'role'>): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, type: 'access' };
    return this.jwtService.signAsync(payload, {
      algorithm: JWT_ALGORITHM,
      expiresIn: this.accessTtl,
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
  }
}
