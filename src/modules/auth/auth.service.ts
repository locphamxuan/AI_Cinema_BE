import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';

export type RegisterAuthInput = {
  email: string;
  password: string;
  fullName: string;
  role?: UserRole;
};

export type LoginAuthInput = {
  email: string;
  password: string;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterAuthInput) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: this.hashPassword(input.password),
        fullName,
        role: input.role ?? UserRole.MEMBER,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: 'User registered successfully',
      user,
    };
  }

  async login(input: LoginAuthInput) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.passwordHash !== this.hashPassword(input.password)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = createHash('sha256')
      .update(`${user.id}:${user.email}:${Date.now()}`)
      .digest('hex');

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
      },
    };
  }

  private hashPassword(password: string) {
    return createHash('sha256').update(password).digest('hex');
  }
}
