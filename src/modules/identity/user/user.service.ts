import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { hashPassword, normalizeEmail } from 'src/modules/identity/auth/credentials';
import { SessionTokenService } from 'src/modules/identity/auth/session-token.service';
import { CreateStaffUserRequestDto } from './dto/create-staff-user.request.dto';
import { UpdateUserRequestDto } from './dto/update-user.request.dto';
import { USER_PROFILE_SELECT, type UserProfile } from './user-profile';

const PROFILE_COLUMNS = Object.keys(USER_PROFILE_SELECT) as (keyof typeof USER_PROFILE_SELECT)[];

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly sessions: SessionTokenService,
  ) {}

  /** Staff holding only member:ops.read see members and nothing else (BR-20). */
  async findAll(query: PaginateQuery, caller: AuthenticatedUser) {
    const canReadStaff = (await this.accessControl.permissionsOf(caller.role)).has(PERMISSION.USER_READ);
    return paginate(query, this.prisma.user, {
      where: canReadStaff ? undefined : { role: UserRole.MEMBER },
      select: PROFILE_COLUMNS,
      sortableColumns: ['email', 'fullName', 'role', 'isActive', 'createdAt'],
      defaultSortBy: [['fullName', 'ASC']],
      searchableColumns: ['email', 'fullName'],
      filterableColumns: { role: ['$eq', '$in'], isActive: ['$eq'] },
    });
  }

  /** The Admin provisions staff accounts; members sign up themselves. */
  async createStaff(dto: CreateStaffUserRequestDto): Promise<UserProfile> {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with this email already exists');
    }
    return this.prisma.user.create({
      data: { email, fullName: dto.fullName.trim(), role: dto.role, passwordHash: await hashPassword(dto.password) },
      select: USER_PROFILE_SELECT,
    });
  }

  async update(userId: string, dto: UpdateUserRequestDto, caller: AuthenticatedUser): Promise<UserProfile> {
    if (userId === caller.id && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException('You cannot change your own role or lock your own account');
    }
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
    if (!existing) throw new NotFoundException(`User with id "${userId}" does not exist`);
    const email = dto.email === undefined ? undefined : normalizeEmail(dto.email);
    if (
      email &&
      email !== existing.email &&
      (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }))
    ) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName?.trim(),
        email,
        role: dto.role,
        isActive: dto.isActive,
        ...(dto.password ? { passwordHash: await hashPassword(dto.password) } : {}),
      },
      select: USER_PROFILE_SELECT,
    });
    this.accessControl.forgetAccount(userId);
    // A locked account, a new role or a new password must not keep the sessions issued before.
    if (dto.isActive === false || dto.password || (dto.role !== undefined && dto.role !== existing.role)) {
      await this.sessions.revokeAll(userId);
    }
    return user;
  }

  /**
   * Deletes an account that never did anything in the platform (its notifications and sessions go with it).
   * An account that already owns projects, reviews, deliveries or Token entries is part of that history:
   * lock it instead.
   */
  async remove(userId: string, caller: AuthenticatedUser): Promise<void> {
    if (userId === caller.id) throw new BadRequestException('You cannot delete your own account');
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      throw new NotFoundException(`User with id "${userId}" does not exist`);
    }
    try {
      await this.prisma.user.delete({ where: { id: userId } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2003') {
        throw new ConflictException(
          'This account already has activity in the platform; lock it instead of deleting it',
        );
      }
      throw error;
    }
    this.accessControl.forgetAccount(userId);
  }
}
