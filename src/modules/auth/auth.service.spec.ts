import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from './auth.service';

const reviewer = {
  id: 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  email: 'reviewer@aicinema.com',
  fullName: 'Reviewer',
  role: UserRole.CONTENT_REVIEWER,
  isActive: true,
  passwordHash: bcrypt.hashSync('Aicinema@123', 10),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  describe('login', () => {
    it('issues an access token carrying the user id and role', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);

      const session = await service.login({ email: reviewer.email, password: 'Aicinema@123' });

      expect(jwtService.verify(session.accessToken)).toMatchObject({
        sub: reviewer.id,
        role: UserRole.CONTENT_REVIEWER,
        type: 'access',
      });
      expect(session.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);

      await expect(service.login({ email: reviewer.email, password: 'wrong-password' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a deactivated account', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...reviewer, isActive: false });

      await expect(service.login({ email: reviewer.email, password: 'Aicinema@123' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('register', () => {
    it('stores a hashed password instead of the plain one', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: typeof reviewer }) => ({ ...reviewer, ...data }));

      await service.register({
        email: 'creator@aicinema.com',
        password: 'Aicinema@123',
        fullName: 'Creator',
      });

      const [{ data }] = prisma.user.create.mock.calls[0] as [{ data: typeof reviewer }];
      const stored = data.passwordHash;
      expect(stored).not.toBe('Aicinema@123');
      expect(await bcrypt.compare('Aicinema@123', stored)).toBe(true);
    });

    it('always signs up a viewer, whatever role the body claims', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: typeof reviewer }) => ({ ...reviewer, ...data }));

      await service.register({
        email: 'x@aicinema.com',
        password: 'Aicinema@123',
        fullName: 'X',
        role: 'ADMIN',
      } as never);

      const [{ data }] = prisma.user.create.mock.calls[0] as [{ data: typeof reviewer }];
      expect(data.role).toBe(UserRole.MEMBER);
    });

    it('rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);

      await expect(
        service.register({
          email: reviewer.email,
          password: 'Aicinema@123',
          fullName: 'Reviewer',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('refresh', () => {
    it('refuses an access token so it cannot be used as a refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);
      const { accessToken } = await service.login({ email: reviewer.email, password: 'Aicinema@123' });

      await expect(service.refresh(accessToken)).rejects.toThrow(UnauthorizedException);
    });

    it('issues a new session from a valid refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);
      const { refreshToken } = await service.login({ email: reviewer.email, password: 'Aicinema@123' });

      const renewed = await service.refresh(refreshToken);

      expect(jwtService.verify(renewed.accessToken)).toMatchObject({ sub: reviewer.id, type: 'access' });
    });
  });
});
