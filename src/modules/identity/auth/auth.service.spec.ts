import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import type { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { AuthService } from './auth.service';
import type { GoogleTokenVerifier } from './google-token.verifier';
import type { SessionTokenService } from './session-token.service';

const profile = {
  id: 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  email: 'reviewer@aicinema.com',
  fullName: 'Reviewer',
  dateOfBirth: null,
  phoneNumber: null,
  role: UserRole.CONTENT_REVIEWER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const passwordHash = bcrypt.hashSync('Aicinema@123', 4);
const tokens = { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 };

describe('AuthService', () => {
  const user = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() };
  const tx = { user };
  const prisma = { user, $transaction: jest.fn(<T>(work: (client: typeof tx) => Promise<T>) => work(tx)) };
  const wallets = { openForNewAccount: jest.fn() };
  const sessions = { issue: jest.fn(), rotate: jest.fn(), revoke: jest.fn(), revokeAll: jest.fn() };
  const accessControl = { permissionsOf: () => Promise.resolve(new Set(['project:manage', 'content:review'])) };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionTokenService,
    accessControl as unknown as AccessControlService,
    wallets as unknown as WalletService,
    { verify: jest.fn() } as unknown as GoogleTokenVerifier,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.issue.mockResolvedValue(tokens);
  });

  describe('login', () => {
    it('returns a session with the profile and the sorted permissions, never the hash', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...profile, passwordHash });

      const session = await service.login({ email: '  Reviewer@AICinema.com ', password: 'Aicinema@123' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'reviewer@aicinema.com' } }),
      );
      expect(session).toMatchObject({
        ...tokens,
        user: { id: profile.id, permissions: ['content:review', 'project:manage'] },
      });
      expect(session.user).not.toHaveProperty('passwordHash');
    });

    it('answers the same way for an unknown email and a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'nobody@aicinema.com', password: 'x' })).rejects.toThrow(
        new UnauthorizedException('Incorrect email or password'),
      );
      prisma.user.findUnique.mockResolvedValue({ ...profile, passwordHash });
      await expect(service.login({ email: profile.email, password: 'wrong' })).rejects.toThrow(
        new UnauthorizedException('Incorrect email or password'),
      );
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    it('refuses a locked account even with the right password', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...profile, passwordHash, isActive: false });
      await expect(service.login({ email: profile.email, password: 'Aicinema@123' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('register', () => {
    const dto = { email: 'Member@Example.com', password: 'Secret123', fullName: ' Anh ' };

    it('creates a member with a hashed password and no birthday (BR-54)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...profile, role: UserRole.MEMBER });

      await service.register(dto);

      const [{ data }] = prisma.user.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data).toMatchObject({ email: 'member@example.com', fullName: 'Anh', role: UserRole.MEMBER });
      expect(data).not.toHaveProperty('dateOfBirth');
      expect(await bcrypt.compare('Secret123', data.passwordHash as string)).toBe(true);
      expect(wallets.openForNewAccount).toHaveBeenCalledWith(tx, profile.id);
    });

    it('rejects an email that already has an account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('own profile', () => {
    const caller = { id: profile.id, role: UserRole.CONTENT_REVIEWER };

    it('saves the name and phone number the owner typed', async () => {
      prisma.user.update.mockResolvedValue({ ...profile, phoneNumber: '0912345678' });
      await service.updateMe(caller, { fullName: 'Ngoc', phoneNumber: '0912345678' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: profile.id },
          data: expect.objectContaining({ phoneNumber: '0912345678' }),
        }),
      );
    });

    it('refuses a birthday in the future', async () => {
      await expect(service.updateMe(caller, { dateOfBirth: '2999-01-01' })).rejects.toThrow(BadRequestException);
    });

    it('changes the password only with the current one, then signs every other session out', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...profile, passwordHash });
      await expect(
        service.changePassword(profile.id, { currentPassword: 'wrong', newPassword: 'Newpass123' }),
      ).rejects.toThrow(UnauthorizedException);

      await service.changePassword(profile.id, { currentPassword: 'Aicinema@123', newPassword: 'Newpass123' });
      expect(sessions.revokeAll).toHaveBeenCalledWith(profile.id);
      expect(sessions.issue).toHaveBeenCalled();
    });
  });

  it('refreshes by rotating the token and reloading the profile', async () => {
    sessions.rotate.mockResolvedValue({ userId: profile.id, tokens });
    prisma.user.findUniqueOrThrow.mockResolvedValue(profile);

    await expect(service.refresh('old-token')).resolves.toMatchObject({ ...tokens, user: { id: profile.id } });
    expect(sessions.rotate).toHaveBeenCalledWith('old-token');
  });
});
