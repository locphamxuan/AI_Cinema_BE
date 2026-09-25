import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccessControlService } from 'src/modules/access-control/access-control.service';
import { AuthSessionDto } from './dto/auth-session.dto';
import { LoginRequestDto } from './dto/login.request.dto';
import { RegisterRequestDto } from './dto/register.request.dto';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly accessControl: AccessControlService,
  ) {}

  async register(dto: RegisterRequestDto): Promise<AuthSessionDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS),
        fullName: dto.fullName,
        role: UserRole.MEMBER,
      },
    });

    return this.buildSession(user);
  }

  async login(dto: LoginRequestDto): Promise<AuthSessionDto> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return this.buildSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSessionDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Access token cannot be used to refresh a session');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer available');
    }

    return this.buildSession(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer available');
    }
    return this.profileWithPermissions(user);
  }

  private async buildSession(user: User): Promise<AuthSessionDto> {
    const claims = { sub: user.id, email: user.email, role: user.role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...claims, type: 'access' }, this.lifetime('JWT_ACCESS_EXPIRES_IN', '1h')),
      this.jwtService.signAsync({ ...claims, type: 'refresh' }, this.lifetime('JWT_REFRESH_EXPIRES_IN', '30d')),
    ]);

    return { accessToken, refreshToken, user: await this.profileWithPermissions(user) };
  }

  // Read from process.env rather than ConfigService: @nestjs/config v12 is ESM-only and cannot be
  // required by Jest, which would make this service untestable. ConfigModule still populates env.
  // `expiresIn` is typed as the `ms` StringValue union, which a plain string cannot satisfy structurally.
  private lifetime(key: string, fallback: string): JwtSignOptions {
    return { expiresIn: process.env[key] ?? fallback } as JwtSignOptions;
  }

  // The web portal shows each account only the screens and actions its role may use.
  private async profileWithPermissions(user: User) {
    const permissions = [...(await this.accessControl.permissionsOf(user.role))].sort();
    return { ...this.toProfile(user), permissions };
  }

  private toProfile(user: User) {
    const { passwordHash: _passwordHash, ...profile } = user;
    return profile;
  }
}
