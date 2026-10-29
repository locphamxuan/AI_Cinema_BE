import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { USER_PROFILE_SELECT, type UserProfile } from 'src/modules/identity/user/user-profile';
import { hashPassword, isAdult, normalizeEmail, verifyPassword } from './credentials';
import type { AuthProfileDto, AuthSessionDto } from './dto/auth-session.dto';
import type { GoogleLoginRequestDto } from './dto/google-login.request.dto';
import { LoginRequestDto } from './dto/login.request.dto';
import type { ChangeMyPasswordRequestDto, UpdateMyProfileRequestDto } from './dto/profile.request.dto';
import { RegisterRequestDto } from './dto/register.request.dto';
import { GOOGLE_REASON, GoogleTokenVerifier, type GoogleProfile } from './google-token.verifier';
import { SessionTokenService } from './session-token.service';

const ADULTS_ONLY = 'AI Cinema is only for viewers aged 18 or older';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SessionTokenService,
    private readonly accessControl: AccessControlService,
    private readonly wallets: WalletService,
    private readonly google: GoogleTokenVerifier,
  ) {}

  async register(dto: RegisterRequestDto): Promise<AuthSessionDto> {
    const dateOfBirth = new Date(dto.dateOfBirth);
    if (!isAdult(dateOfBirth)) throw new ForbiddenException(ADULTS_ONLY);
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

  /**
   * Signs in with a Google ID token. The first sign-in either opens a member account, which needs
   * a birthday like any other (BR-54), or links an existing account, which needs its password:
   * no email is verified at registration, so whoever registered it may not own the inbox. Both
   * are asked for with a 422 `reason`, and the client resends the same token with the answer.
   */
  async googleLogin(dto: GoogleLoginRequestDto): Promise<AuthSessionDto> {
    const profile = await this.google.verify(dto.idToken);
    const user =
      (await this.prisma.user.findUnique({ where: { googleId: profile.sub }, select: USER_PROFILE_SELECT })) ??
      (await this.linkOrOpen(profile));
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
      throw new ForbiddenException(ADULTS_ONLY);
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

  private async linkOrOpen(profile: GoogleProfile): Promise<UserProfile> {
    const email = normalizeEmail(profile.email);
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { ...USER_PROFILE_SELECT, googleId: true },
    });
    if (!existing) return this.openGoogleMember(profile, email);
    const { googleId, ...user } = existing;
    if (googleId) {
      throw new ConflictException({
        message: 'This email is linked to another Google account',
        details: { reason: GOOGLE_REASON.ACCOUNT_MISMATCH },
      });
    }
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');
    // Google already proved the mailbox (email_verified), so the account it names is linked as is.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { googleId: profile.sub, emailVerifiedAt: new Date() },
    });
    return user;
  }

  /** One tap: the member account opens at once under the Google name; the birthday can be added on the profile later. */
  private async openGoogleMember(profile: GoogleProfile, email: string): Promise<UserProfile> {
    const name = profile.name?.trim() ?? '';
    const fullName = name.length >= 2 ? name : email.split('@')[0].padEnd(2, '_');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash: null,
          fullName,
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

  private async session(user: UserProfile): Promise<AuthSessionDto> {
    return { ...(await this.tokens.issue(user)), user: await this.withPermissions(user) };
  }

  // The web portal shows each account only the screens and actions its role may use.
  private async withPermissions(user: UserProfile): Promise<AuthProfileDto> {
    return { ...user, permissions: [...(await this.accessControl.permissionsOf(user.role))].sort() };
  }
}
