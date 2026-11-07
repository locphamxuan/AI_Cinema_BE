import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { hashPassword, normalizeEmail } from 'src/modules/identity/auth/credentials';
import { USER_PROFILE_SELECT } from 'src/modules/identity/user/user-profile';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { CreateStudioAccountRequestDto } from './dto/studio-account.request.dto';

const ACCOUNT_SELECT = { ...USER_PROFILE_SELECT, studioId: true } as const;

/**
 * MF-1 (07/11/2026): a partner studio logs into AI Cinema with STUDIO accounts the Admin opens for it, so the
 * platform knows who holds each hand-off. A STUDIO account only reaches its own studio's contracts and films.
 */
@Injectable()
export class StudioAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  list(studioId: string) {
    return this.prisma.user.findMany({
      where: { studioId, role: UserRole.STUDIO },
      orderBy: { createdAt: 'asc' },
      select: ACCOUNT_SELECT,
    });
  }

  async create(studioId: string, dto: CreateStudioAccountRequestDto, admin: AuthenticatedUser) {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await hashPassword(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.user.create({
        data: { email, fullName: dto.fullName.trim(), role: UserRole.STUDIO, studioId, passwordHash },
        select: ACCOUNT_SELECT,
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.STUDIO_ACCOUNT_CREATED,
          entityType: 'Studio',
          entityId: studioId,
          projectId: null,
          actorId: admin.id,
          payload: { userId: account.id, email },
        },
        tx,
      );
      return account;
    });
  }

  /** The studio a STUDIO caller speaks for; anyone else is refused. */
  async studioOf(user: AuthenticatedUser, tx?: PrismaTx): Promise<string> {
    if (user.role !== UserRole.STUDIO) throw new ForbiddenException('Only a studio account can do that');
    const account = await (tx ?? this.prisma).user.findUnique({ where: { id: user.id }, select: { studioId: true } });
    if (!account?.studioId) throw new ForbiddenException('This account is not tied to a studio');
    return account.studioId;
  }
}
