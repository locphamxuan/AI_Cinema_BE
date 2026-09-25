import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { AccessControlService } from 'src/modules/access-control/access-control.service';
import { UpdateUserRequestDto } from './dto/update-user.request.dto';

// Never passwordHash.
const PUBLIC_COLUMNS = ['id', 'email', 'fullName', 'role', 'isActive', 'createdAt', 'updatedAt'] as const;
const PUBLIC_FIELDS = Object.fromEntries(PUBLIC_COLUMNS.map((c) => [c, true])) as Record<
  (typeof PUBLIC_COLUMNS)[number],
  true
>;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Staff holding only member:ops.read see members and nothing else (BR-20). */
  async findAll(query: PaginateQuery, caller: AuthenticatedUser) {
    const canReadStaff = (await this.accessControl.permissionsOf(caller.role)).has(PERMISSION.USER_READ);
    return paginate(query, this.prisma.user, {
      where: canReadStaff ? undefined : { role: UserRole.MEMBER },
      select: [...PUBLIC_COLUMNS],
      sortableColumns: ['id', 'email', 'fullName', 'role', 'isActive', 'createdAt', 'updatedAt'],
      defaultSortBy: [['fullName', 'ASC']],
      searchableColumns: ['email', 'fullName'],
      filterableColumns: {
        role: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }

  async update(userId: string, dto: UpdateUserRequestDto, caller: AuthenticatedUser) {
    if (userId === caller.id && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException('You cannot change your own role or lock your own account');
    }
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw new NotFoundException(`User with id "${userId}" does not exist`);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role, isActive: dto.isActive },
      select: PUBLIC_FIELDS,
    });
    this.accessControl.forgetAccount(userId);
    return user;
  }
}
