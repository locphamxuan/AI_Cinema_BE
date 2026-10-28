import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { USER_PROFILE_SELECT, type UserProfile } from 'src/modules/identity/user/user-profile';
import { hashPassword, isAdult, normalizeEmail, verifyPassword } from './credentials';
import type { AuthProfileDto, AuthSessionDto } from './dto/auth-session.dto';
import { GoogleLoginRequestDto } from './dto/google-login.request.dto';
import { LoginRequestDto } from './dto/login.request.dto';
import type { ChangeMyPasswordRequestDto, UpdateMyProfileRequestDto } from './dto/profile.request.dto';
import { RegisterRequestDto } from './dto/register.request.dto';
import { SessionTokenService } from './session-token.service';
import { GoogleTokenVerifier } from './google-token.verifier';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SessionTokenService,
    private readonly accessControl: AccessControlService,
    private readonly wallets: WalletService,
    private readonly google: GoogleTokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterRequestDto): Promise<AuthSessionDto> {
    const dateOfBirth = new Date(dto.dateOfBirth);
    if (!isAdult(dateOfBirth)) {
      throw new ForbiddenException('AI Cinema is only for viewers aged 18 or older');
    }
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hashPassword(dto.password);
    // The account, its wallet and the welcome bonus all commit together: a member that exists
    // always has a wallet, so no purchase screen ever has to open one on the spot.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, fullName: dto.fullName.trim(), dateOfBirth, role: UserRole.MEMBER },
        select: USER_PROFILE_SELECT,
      });
      await this.wallets.openForNewAccount(tx, created.id);
      return created;
    });
    return this.session(user);
  }

  async login(dto: LoginRequestDto): Promise<AuthSessionDto> {
    const found = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      select: { ...USER_PROFILE_SELECT, passwordHash: true },
    });
    if (found && !found.passwordHash) {
      throw new UnauthorizedException('This account uses Google sign-in; sign in with Google instead');
    }
    // The hash is always compared so an unknown email takes as long as a wrong password.
    const passwordMatches = await verifyPassword(dto.password, found?.passwordHash);
    if (!found || !passwordMatches) throw new UnauthorizedException('Incorrect email or password');
    if (!found.isActive) throw new ForbiddenException('This account has been deactivated');

    const { passwordHash: _hash, ...user } = found;
    return this.session(user);
  }

  async googleLogin(dto: GoogleLoginRequestDto): Promise<AuthSessionDto> {
    const profile = await this.google.verify(dto.idToken);
    const email = normalizeEmail(profile.email);

    let user = await this.prisma.user.findUnique({
      where: { googleId: profile.sub },
      select: USER_PROFILE_SELECT,
    });

    if (!user) {
      const existing = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true, googleId: true, emailVerifiedAt: true },
      });

      if (existing) {
        if (!existing.googleId) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: { googleId: profile.sub, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
          });
        }
        user = await this.prisma.user.findUniqueOrThrow({
          where: { id: existing.id },
          select: USER_PROFILE_SELECT,
        });
      } else {
        let fullName = (profile.name ?? '').trim();
        if (fullName.length < 2) fullName = email.split('@')[0];
        if (fullName.length < 2) fullName = 'Google User';

        user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email,
              passwordHash: null,
              fullName,
              dateOfBirth: null,
              role: UserRole.MEMBER,
              googleId: profile.sub,
              emailVerifiedAt: new Date(),
            },
            select: USER_PROFILE_SELECT,
          });
          await this.wallets.openForNewAccount(tx, created.id);
          return created;
        });
      }
    }

    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');
    return this.session(user);
  }

  async refresh(refreshToken: string): Promise<AuthSessionDto> {
    const { userId, tokens } = await this.tokens.rotate(refreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: USER_PROFILE_SELECT });
    return { ...tokens, user: await this.withPermissions(user) };
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  async me(userId: string): Promise<AuthProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_PROFILE_SELECT });
    if (!user) throw new UnauthorizedException('Account no longer available');
    return this.withPermissions(user);
  }

  async updateMe(caller: AuthenticatedUser, dto: UpdateMyProfileRequestDto): Promise<AuthProfileDto> {
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined;
    if (dateOfBirth && dateOfBirth.getTime() > Date.now())
      throw new BadRequestException('Birthday cannot be in the future');
    if (dateOfBirth && caller.role === UserRole.MEMBER && !isAdult(dateOfBirth)) {
      throw new ForbiddenException('AI Cinema is only for viewers aged 18 or older');
    }
    const user = await this.prisma.user.update({
      where: { id: caller.id },
      data: { fullName: dto.fullName, phoneNumber: dto.phoneNumber, dateOfBirth },
      select: USER_PROFILE_SELECT,
    });
    return this.withPermissions(user);
  }

  async changePassword(userId: string, dto: ChangeMyPasswordRequestDto): Promise<AuthSessionDto> {
    const found = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...USER_PROFILE_SELECT, passwordHash: true },
    });
    if (!found) throw new UnauthorizedException('The current password is incorrect');
    if (!found.passwordHash) {
      throw new BadRequestException('This account has no password; it uses Google sign-in');
    }
    if (!(await verifyPassword(dto.currentPassword, found.passwordHash))) {
      throw new UnauthorizedException('The current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException('Choose a password different from the current one');
    const { passwordHash: _hash, ...user } = found;
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    await this.tokens.revokeAll(userId);
    return this.session(user);
  }

  private async session(user: UserProfile): Promise<AuthSessionDto> {
    return { ...(await this.tokens.issue(user)), user: await this.withPermissions(user) };
  }

  // The web portal shows each account only the screens and actions its role may use.
  private async withPermissions(user: UserProfile): Promise<AuthProfileDto> {
    return { ...user, permissions: [...(await this.accessControl.permissionsOf(user.role))].sort() };
  }
}
