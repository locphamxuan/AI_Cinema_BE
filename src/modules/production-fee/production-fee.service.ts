import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MovieStatus, TokenEntryType } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/project-access/project-rules';
import { PlatformSettingService } from 'src/modules/platform-setting/platform-setting.service';
import { AddFeeEntryRequestDto } from './dto/add-fee-entry.request.dto';

const EVENT_BY_TYPE = {
  [TokenEntryType.INITIAL]: CONTENT_EVENT.FEE_ALLOCATED,
  [TokenEntryType.TOP_UP]: CONTENT_EVENT.FEE_TOPPED_UP,
  [TokenEntryType.CORRECTION]: CONTENT_EVENT.FEE_CORRECTED,
} as const;

/**
 * Production fee of a movie in Token (BR-45, BR-46): an append-only ledger whose sum is the
 * fee. The first allocation (INITIAL) happens while the project is a DRAFT; top-ups and
 * corrections need a reason, and a correction may never bring the fee to zero or below.
 */
@Injectable()
export class ProductionFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly settings: PlatformSettingService,
    private readonly auditLog: AuditLogService,
  ) {}

  async totalTokens(movieId: string, tx?: PrismaTx): Promise<number> {
    const { _sum } = await (tx ?? this.prisma).tokenLedgerEntry.aggregate({
      where: { movieId },
      _sum: { amountTokens: true },
    });
    return Number(_sum.amountTokens ?? 0n);
  }

  async ledger(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    const entries = await this.prisma.tokenLedgerEntry.findMany({
      where: { movieId },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    const totalTokens = entries.reduce((sum, entry) => sum + Number(entry.amountTokens), 0);
    // Each entry keeps the rate it was written at (BR-50).
    const totalVnd = entries.reduce((sum, entry) => sum + Number(entry.amountTokens) * entry.rateVnd, 0);
    return { totalTokens, totalVnd, entries };
  }

  async addEntry(movieId: string, dto: AddFeeEntryRequestDto, user: AuthenticatedUser) {
    const { tokenRateVnd } = await this.settings.get();
    await this.prisma.$transaction(async (tx) => {
      // Serialises ledger writes of one movie, so "only one INITIAL" and "total stays > 0" hold.
      await tx.$queryRaw`SELECT id FROM movies WHERE id = ${movieId}::uuid FOR UPDATE`;
      const movie = await this.access.movie(movieId, user, 'reviewer', tx);
      const total = await this.totalTokens(movieId, tx);
      this.assertAllowed(dto, movie.status, total);

      const entry = await tx.tokenLedgerEntry.create({
        data: {
          movieId,
          entryType: dto.entryType,
          amountTokens: BigInt(dto.amountTokens),
          rateVnd: tokenRateVnd,
          reason: dto.reason?.trim(),
          createdById: user.id,
        },
      });
      await this.auditLog.record(
        {
          action: EVENT_BY_TYPE[dto.entryType],
          entityType: 'TokenLedgerEntry',
          entityId: entry.id,
          movieId,
          actorId: user.id,
          payload: { amountTokens: dto.amountTokens, reason: dto.reason },
        },
        tx,
      );
    });
    return this.ledger(movieId, user);
  }

  private assertAllowed(dto: AddFeeEntryRequestDto, status: MovieStatus, total: number): void {
    if (dto.entryType === TokenEntryType.INITIAL) {
      assertProjectStatus(status, [MovieStatus.DRAFT], 'allocate the initial production fee');
      if (total !== 0) throw new ConflictException('The initial production fee was already allocated');
      if (dto.amountTokens <= 0) throw new BadRequestException('The production fee must be more than 0 Token');
      return;
    }
    // A studio may charge for fixing taken-down episodes (BR-56).
    assertProjectStatus(status, [...OPEN_PROJECT_STATUSES, MovieStatus.UNDER_REVISION], 'change the production fee');
    if (total === 0) throw new ConflictException('Allocate the initial production fee first');
    if (!dto.reason?.trim()) throw new BadRequestException('A top-up or a correction needs a reason (BR-46)');
    if (dto.entryType === TokenEntryType.TOP_UP && dto.amountTokens <= 0) {
      throw new BadRequestException('A top-up must add Token');
    }
    if (dto.entryType === TokenEntryType.CORRECTION && (dto.amountTokens === 0 || total + dto.amountTokens <= 0)) {
      throw new BadRequestException('A correction must change the fee and keep it above 0 Token');
    }
  }
}
