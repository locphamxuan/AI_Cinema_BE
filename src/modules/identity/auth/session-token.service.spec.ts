import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { REUSE_GRACE_MS, SessionTokenService } from './session-token.service';

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

  const row = (over: object) => ({
    id: 'rt-1',
    userId: 'u1',
    oauthClientId: null,
    revokedAt: null,
    replacedById: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: 'u1', role: 'MEMBER', isActive: true },
    ...over,
  });
  const tx = { refreshToken: { create: jest.fn(), updateMany: jest.fn() } };
  const runTx = () => prisma.$transaction.mockImplementation((work: (db: typeof tx) => Promise<unknown>) => work(tx));

  it('lets a refresh retried right after a lost answer carry on from the token that replaced it', async () => {
    runTx();
    tx.refreshToken.create.mockResolvedValue({ id: 'rt-3' });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.findUnique.mockResolvedValue(
      row({ revokedAt: new Date(Date.now() - 5_000), replacedById: 'rt-2' }),
    );

    const res = await service.rotate('old');

    expect(res.userId).toBe('u1');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-2', revokedAt: null } }),
    );
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('still signs every session out when an old token comes back after the grace window', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(
      row({ revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 1_000), replacedById: 'rt-2' }),
    );
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.rotate('old')).rejects.toThrow('already used');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: expect.anything(),
    });
  });

  it('refuses a signed-out token without signing every other device out', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(row({ revokedAt: new Date(Date.now() - 5_000) }));

    await expect(service.rotate('signed-out')).rejects.toMatchObject({
      response: { details: { reason: 'REFRESH_TOKEN_INVALID' } },
    });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers REFRESH_TOKEN_REUSED when a swapped token is replayed', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(
      row({ revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 1_000), replacedById: 'rt-2' }),
    );
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.rotate('old')).rejects.toMatchObject({
      response: { details: { reason: 'REFRESH_TOKEN_REUSED' } },
    });
  });

  it('refuses an expired token or a locked account with REFRESH_TOKEN_INVALID', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date(Date.now() - 1) }));
    await expect(service.rotate('expired')).rejects.toMatchObject({
      response: { details: { reason: 'REFRESH_TOKEN_INVALID' } },
    });
    prisma.refreshToken.findUnique.mockResolvedValueOnce(row({ user: { id: 'u1', role: 'MEMBER', isActive: false } }));
    await expect(service.rotate('locked')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads the token again when a parallel refresh swapped it first', async () => {
    runTx();
    tx.refreshToken.create.mockResolvedValue({ id: 'new' });
    tx.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(row({}))
      .mockResolvedValueOnce(row({ revokedAt: new Date(), replacedById: 'winner' }));

    await expect(service.rotate('same')).resolves.toMatchObject({ userId: 'u1' });
    expect(tx.refreshToken.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'winner', revokedAt: null } }),
    );
  });

  it('opens one more session on each login and never ends the sessions of other accounts or windows', async () => {
    // The owner signs in as Creator, Reviewer and Admin in three windows: three independent token families.
    prisma.refreshToken.create.mockResolvedValue({});
    const pairs = await Promise.all(
      ['u-creator', 'u-reviewer', 'u-admin'].map((id) => service.issue({ id, role: 'ADMIN' })),
    );

    expect(new Set(pairs.map((pair) => pair.refreshToken)).size).toBe(3);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(3);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
