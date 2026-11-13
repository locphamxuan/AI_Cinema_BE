import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { SessionTokenService } from './session-token.service';

describe('SessionTokenService.rotate', () => {
  const prisma = {
    refreshToken: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new SessionTokenService(
    prisma as unknown as PrismaService,
    { signAsync: jest.fn() } as unknown as JwtService,
    { jwt: { accessTtlSeconds: 900, refreshTtlDays: 30 } } as unknown as AppConfig,
  );

  beforeEach(() => jest.clearAllMocks());

  it('refuses a refresh token the OAuth endpoint issued, so its scopes cannot be dropped here', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt',
      userId: 'u-studio',
      oauthClientId: 'c-uuid',
      scope: 'studio:portal',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u-studio', role: 'STUDIO', isActive: true },
    });
    await expect(service.rotate('oauth-refresh')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
