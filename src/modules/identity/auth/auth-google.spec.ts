import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import type { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { AuthService } from './auth.service';
import { GOOGLE_REASON, type GoogleTokenVerifier } from './google-token.verifier';
import type { SessionTokenService } from './session-token.service';

const member = {
  id: 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  email: 'member@example.com',
  fullName: 'Member',
  dateOfBirth: new Date('2000-01-01'),
  phoneNumber: null,
  role: UserRole.MEMBER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const passwordHash = bcrypt.hashSync('Aicinema@123', 4);
const tokens = { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 };
const idToken = 'google-id-token';

describe('AuthService.googleLogin', () => {
  const user = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
  const tx = { user };
  const prisma = { user, $transaction: jest.fn(<T>(work: (client: typeof tx) => Promise<T>) => work(tx)) };
  const wallets = { openForNewAccount: jest.fn() };
  const sessions = { issue: jest.fn() };
  const google = { verify: jest.fn() };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionTokenService,
    { permissionsOf: () => Promise.resolve(new Set<string>()) } as unknown as AccessControlService,
    wallets as unknown as WalletService,
    google as unknown as GoogleTokenVerifier,
  );
  // First lookup is by Google subject, the second by email.
  const lookups = (bySubject: unknown, byEmail?: unknown) =>
    user.findUnique.mockResolvedValueOnce(bySubject).mockResolvedValueOnce(byEmail ?? null);

  beforeEach(() => {
    jest.clearAllMocks();
    user.findUnique.mockReset();
    sessions.issue.mockResolvedValue(tokens);
    google.verify.mockResolvedValue({ sub: 'google-sub', email: 'Member@Example.com', name: 'Google Name' });
  });

  it('signs in an account already linked to Google', async () => {
    lookups(member);

    const session = await service.googleLogin({ idToken });

    expect(google.verify).toHaveBeenCalledWith(idToken);
    expect(user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { googleId: 'google-sub' } }));
    expect(session).toMatchObject({ ...tokens, user: { id: member.id } });
    expect(user.create).not.toHaveBeenCalled();
  });

  it('asks for a birthday before opening a new member account (BR-54)', async () => {
    lookups(null);

    await expect(service.googleLogin({ idToken })).rejects.toMatchObject({
      status: 422,
      response: { details: { reason: GOOGLE_REASON.NEEDS_BIRTHDAY } },
    });
    expect(user.create).not.toHaveBeenCalled();
  });

  it('turns away anyone under 18', async () => {
    lookups(null);
    const birthday = new Date(Date.now() - 17 * 365 * 86_400_000).toISOString().slice(0, 10);

    await expect(service.googleLogin({ idToken, dateOfBirth: birthday })).rejects.toThrow(ForbiddenException);
    expect(user.create).not.toHaveBeenCalled();
  });

  it('opens a member account with a wallet once the birthday is given', async () => {
    lookups(null);
    user.create.mockResolvedValue(member);

    const session = await service.googleLogin({ idToken, dateOfBirth: '2000-01-01' });

    expect(user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'member@example.com',
          fullName: 'Google Name',
          role: UserRole.MEMBER,
          googleId: 'google-sub',
          passwordHash: null,
          dateOfBirth: new Date('2000-01-01'),
        }),
      }),
    );
    expect(wallets.openForNewAccount).toHaveBeenCalledWith(tx, member.id);
    expect(session).toMatchObject({ user: { id: member.id } });
  });

  it('asks for the password before linking Google to a password account', async () => {
    lookups(null, { ...member, passwordHash, googleId: null });

    await expect(service.googleLogin({ idToken })).rejects.toMatchObject({
      status: 422,
      response: { details: { reason: GOOGLE_REASON.NEEDS_PASSWORD } },
    });
    expect(user.update).not.toHaveBeenCalled();
  });

  it('refuses to link with a wrong password', async () => {
    lookups(null, { ...member, passwordHash, googleId: null });

    await expect(service.googleLogin({ idToken, password: 'Wrong@123' })).rejects.toThrow(UnauthorizedException);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('links Google once the password is right and signs in', async () => {
    lookups(null, { ...member, passwordHash, googleId: null });

    const session = await service.googleLogin({ idToken, password: 'Aicinema@123' });

    expect(user.update).toHaveBeenCalledWith({
      where: { id: member.id },
      data: { googleId: 'google-sub', emailVerifiedAt: expect.any(Date) },
    });
    expect(session.user).not.toHaveProperty('passwordHash');
    expect(session.user).not.toHaveProperty('googleId');
  });

  it('refuses an email already linked to another Google account', async () => {
    lookups(null, { ...member, passwordHash: null, googleId: 'other-sub' });

    await expect(service.googleLogin({ idToken })).rejects.toThrow(ConflictException);
  });

  it('refuses a deactivated linked account', async () => {
    lookups({ ...member, isActive: false });

    await expect(service.googleLogin({ idToken })).rejects.toThrow(ForbiddenException);
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('does not link a deactivated account', async () => {
    lookups(null, { ...member, isActive: false, passwordHash, googleId: null });

    await expect(service.googleLogin({ idToken, password: 'Aicinema@123' })).rejects.toThrow(ForbiddenException);
    expect(user.update).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });
});
