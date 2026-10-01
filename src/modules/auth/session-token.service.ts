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
  async rotate(refreshToken: string): Promise<{ userId: string; tokens: TokenPair }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    if (stored.revokedAt) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('This refresh token was already used; every session has been signed out');
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const next = newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId: stored.userId, tokenHash: hashRefreshToken(next), expiresAt: this.refreshExpiry() },
      });
      // Only the request that revokes the token first wins a concurrent double refresh.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      if (count === 0) throw new UnauthorizedException('Invalid refresh token');
    });

    return {
      userId: stored.userId,
      tokens: {
        accessToken: await this.signAccess(stored.user),
        refreshToken: next,
        accessTokenExpiresIn: this.accessTtl,
      },
    };
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
