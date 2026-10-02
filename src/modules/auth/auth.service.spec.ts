import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AccessControlService } from 'src/modules/access-control/access-control.service';
import { AuthService } from './auth.service';
import type { SessionTokenService } from './session-token.service';

const profile = {
  id: 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  email: 'reviewer@aicinema.com',
  fullName: 'Reviewer',
  dateOfBirth: null,
  role: UserRole.CONTENT_REVIEWER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const passwordHash = bcrypt.hashSync('Aicinema@123', 4);
const tokens = { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 };

describe('AuthService', () => {
  const prisma = { user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn() } };
  const sessions = { issue: jest.fn(), rotate: jest.fn(), revoke: jest.fn() };
  const accessControl = { permissionsOf: () => Promise.resolve(new Set(['project:manage', 'content:review'])) };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionTokenService,
    accessControl as unknown as AccessControlService,
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
    const dto = { email: 'Member@Example.com', password: 'Secret123', fullName: ' Anh ', dateOfBirth: '2000-01-01' };

    it('creates an adult member with a hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...profile, role: UserRole.MEMBER });

      await service.register(dto);

      const [{ data }] = prisma.user.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data).toMatchObject({ email: 'member@example.com', fullName: 'Anh', role: UserRole.MEMBER });
      expect(await bcrypt.compare('Secret123', data.passwordHash as string)).toBe(true);
    });

    it('turns away anyone under 18 (BR-54)', async () => {
      const youngster = { ...dto, dateOfBirth: `${new Date().getUTCFullYear() - 17}-01-01` };
      await expect(service.register(youngster)).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects an email that already has an account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  it('refreshes by rotating the token and reloading the profile', async () => {
    sessions.rotate.mockResolvedValue({ userId: profile.id, tokens });
    prisma.user.findUniqueOrThrow.mockResolvedValue(profile);

    await expect(service.refresh('old-token')).resolves.toMatchObject({ ...tokens, user: { id: profile.id } });
    expect(sessions.rotate).toHaveBeenCalledWith('old-token');
  });
});
