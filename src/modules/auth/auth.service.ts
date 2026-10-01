import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/access-control/access-control.service';
import { USER_PROFILE_SELECT, type UserProfile } from 'src/modules/user/user-profile';
import { hashPassword, isAdult, normalizeEmail, verifyPassword } from './credentials';
import type { AuthProfileDto, AuthSessionDto } from './dto/auth-session.dto';
import { LoginRequestDto } from './dto/login.request.dto';
import { RegisterRequestDto } from './dto/register.request.dto';
import { SessionTokenService } from './session-token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SessionTokenService,
    private readonly accessControl: AccessControlService,
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

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(dto.password),
        fullName: dto.fullName.trim(),
        dateOfBirth,
        role: UserRole.MEMBER,
      },
      select: USER_PROFILE_SELECT,
    });
    return this.session(user);
  }

  async login(dto: LoginRequestDto): Promise<AuthSessionDto> {
    const found = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      select: { ...USER_PROFILE_SELECT, passwordHash: true },
    });
    // The hash is always compared so an unknown email takes as long as a wrong password.
    const passwordMatches = await verifyPassword(dto.password, found?.passwordHash);
    if (!found || !passwordMatches) throw new UnauthorizedException('Incorrect email or password');
    if (!found.isActive) throw new ForbiddenException('This account has been deactivated');

    const { passwordHash: _hash, ...user } = found;
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

  private async session(user: UserProfile): Promise<AuthSessionDto> {
    return { ...(await this.tokens.issue(user)), user: await this.withPermissions(user) };
  }

  // The web portal shows each account only the screens and actions its role may use.
  private async withPermissions(user: UserProfile): Promise<AuthProfileDto> {
    return { ...user, permissions: [...(await this.accessControl.permissionsOf(user.role))].sort() };
  }
}
