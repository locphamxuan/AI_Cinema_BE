import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MovieStatus, TokenEntryType } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { ReviewerTokenService } from 'src/modules/production/reviewer-token/reviewer-token.service';
import { AddFeeEntryRequestDto } from './dto/add-fee-entry.request.dto';
import { baselineTokens, summariseSeasonFee } from './season-fee';

const EVENT_BY_TYPE = {
  [TokenEntryType.INITIAL]: CONTENT_EVENT.FEE_ALLOCATED,
  [TokenEntryType.TOP_UP]: CONTENT_EVENT.FEE_TOPPED_UP,
  [TokenEntryType.CORRECTION]: CONTENT_EVENT.FEE_CORRECTED,
} as const;

/** The season an entry is priced for, with what the INITIAL allocation needs to know about it. */
interface PricedSeason {
  id: string;
  episodeProductionCost: bigint;
  episodeCount: number;
  hasInitial: boolean;
}

/**
 * Production fee of a movie in Token (BR-45, BR-46): an append-only ledger whose sum is the fee, paid
 * out of the Reviewer's Token budget. Each season is allocated once (INITIAL = price of one episode ×
 * episodes); more episodes or a higher price later are "+… Token thêm" (TOP_UP) tied to the season.
 * Top-ups and corrections need a reason, and a correction may never bring the fee to zero or below.
 */
@Injectable()
export class ProductionFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly settings: PlatformSettingService,
    private readonly auditLog: AuditLogService,
    private readonly budgets: ReviewerTokenService,
  ) {}

  async totalTokens(movieId: string, tx?: PrismaTx): Promise<number> {
    const { _sum } = await (tx ?? this.prisma).tokenLedgerEntry.aggregate({
      where: { movieId },
      _sum: { amountTokens: true },
    });
    return Number(_sum.amountTokens ?? 0n);
  }

  /** Per-season fee: price, baseline, what was paid and what is still missing. */
  async seasonFees(movieId: string, tx?: PrismaTx) {
    const seasons = await (tx ?? this.prisma).season.findMany({
      where: { movieId },
      orderBy: { seasonNumber: 'asc' },
      include: {
        _count: { select: { episodes: true } },
        tokenEntries: { select: { entryType: true, amountTokens: true } },
        handoffs: { select: { lostTokens: true } },
      },
    });
    return seasons.map(({ _count, tokenEntries, handoffs, ...season }) =>
      summariseSeasonFee({
        ...season,
        episodeCount: _count.episodes,
        entries: tokenEntries,
        lostTokens: handoffs.reduce((sum, { lostTokens }) => sum + lostTokens, 0n),
      }),
    );
  }

  /**
   * What a new brief may promise the studio (BR-59): the fee minus what replaced studios already cost, for the
   * season when one is named (never more than the project still has), else for the whole project.
   * `pendingLostTokens` = the hand-offs about to be replaced by this brief.
   */
  async spendableTokens(movieId: string, seasonId: string | null, pendingLostTokens = 0, tx?: PrismaTx) {
    const db = tx ?? this.prisma;
    const [projectFee, projectLost] = await Promise.all([
      this.totalTokens(movieId, tx),
      db.studioHandoff.aggregate({ where: { movieId }, _sum: { lostTokens: true } }),
    ]);
    const projectLeft = projectFee - Number(projectLost._sum.lostTokens ?? 0n) - pendingLostTokens;
    if (!seasonId) return Math.max(0, projectLeft);

    const [seasonFee, seasonLost, wholeProjectEntries] = await Promise.all([
      db.tokenLedgerEntry.aggregate({ where: { movieId, seasonId }, _sum: { amountTokens: true } }),
      db.studioHandoff.aggregate({ where: { movieId, seasonId }, _sum: { lostTokens: true } }),
      db.tokenLedgerEntry.count({ where: { movieId, seasonId: null } }),
    ]);
    const seasonTokens = Number(seasonFee._sum.amountTokens ?? 0n);
    // A project funded as a whole before its seasons were priced has no season entries: the project fee stands.
    if (seasonTokens === 0 && wholeProjectEntries > 0) return Math.max(0, projectLeft);
    const seasonLeft = seasonTokens - Number(seasonLost._sum.lostTokens ?? 0n) - pendingLostTokens;
    return Math.max(0, Math.min(seasonLeft, projectLeft));
  }

  /** True once every season was allocated, or the project was funded as a whole before seasons were priced. */
  async isFunded(movieId: string, tx?: PrismaTx): Promise<boolean> {
    const db = tx ?? this.prisma;
    if (await db.tokenLedgerEntry.count({ where: { movieId, seasonId: null, entryType: TokenEntryType.INITIAL } })) {
      return true;
    }
    const fees = await this.seasonFees(movieId, tx);
    return fees.length > 0 && fees.every((fee) => fee.hasInitial && fee.episodeProductionCost > 0);
  }

  async ledger(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    const entries = await this.prisma.tokenLedgerEntry.findMany({
      where: { movieId },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        season: { select: { id: true, seasonNumber: true, title: true } },
      },
    });
    const totalTokens = entries.reduce((sum, entry) => sum + Number(entry.amountTokens), 0);
    // Each entry keeps the rate it was written at (BR-50).
    const totalVnd = entries.reduce((sum, entry) => sum + Number(entry.amountTokens) * entry.rateVnd, 0);
    return { totalTokens, totalVnd, seasons: await this.seasonFees(movieId), entries };
  }

  async addEntry(movieId: string, dto: AddFeeEntryRequestDto, user: AuthenticatedUser) {
    const { tokenRateVnd } = await this.settings.get();
    await this.prisma.$transaction(async (tx) => {
      // Serialises ledger writes of one movie, so "one INITIAL per season" and "total stays > 0" hold.
      await tx.$queryRaw`SELECT id FROM movies WHERE id = ${movieId}::uuid FOR UPDATE`;
      const movie = await this.access.movie(movieId, user, 'reviewer', tx);
      const total = await this.totalTokens(movieId, tx);
      const season = dto.seasonId ? await this.pricedSeason(tx, movieId, dto.seasonId) : null;
      const amount = this.assertAllowed(dto, movie.status, total, season);
      // The fee comes out of the Reviewer's own Token budget, granted by the Admin.
      await this.budgets.assertCanSpend(tx, user.id, amount);

      const entry = await tx.tokenLedgerEntry.create({
        data: {
          movieId,
          seasonId: season?.id,
          entryType: dto.entryType,
          amountTokens: BigInt(amount),
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
          payload: { amountTokens: amount, seasonId: season?.id ?? null, reason: dto.reason },
        },
        tx,
      );
      await this.budgets.notifyAllocation(tx, { reviewer: user, movie, type: dto.entryType, amount });
    });
    return this.ledger(movieId, user);
  }

  private async pricedSeason(tx: PrismaTx, movieId: string, seasonId: string): Promise<PricedSeason> {
    const season = await tx.season.findFirst({
      where: { id: seasonId, movieId },
      include: { _count: { select: { episodes: true } } },
    });
    if (!season) throw new BadRequestException('The season does not belong to this project');
    const hasInitial = await tx.tokenLedgerEntry.count({
      where: { movieId, entryType: TokenEntryType.INITIAL, OR: [{ seasonId }, { seasonId: null }] },
    });
    return {
      id: season.id,
      episodeProductionCost: season.episodeProductionCost,
      episodeCount: season._count.episodes,
      hasInitial: hasInitial > 0,
    };
  }

  /** Throws when the entry is not allowed; returns the Token it books. */
  private assertAllowed(dto: AddFeeEntryRequestDto, status: MovieStatus, total: number, season: PricedSeason | null) {
    if (dto.entryType === TokenEntryType.INITIAL) return this.assertInitial(status, season);

    // A studio may charge for fixing taken-down episodes (BR-56).
    assertProjectStatus(status, [...OPEN_PROJECT_STATUSES, MovieStatus.UNDER_REVISION], 'change the production fee');
    if (total === 0) throw new ConflictException('Allocate the initial production fee first');
    if (!dto.reason?.trim()) throw new BadRequestException('A top-up or a correction needs a reason (BR-46)');
    const amount = dto.amountTokens ?? 0;
    if (dto.entryType === TokenEntryType.TOP_UP && amount <= 0) {
      throw new BadRequestException('A top-up must add Token');
    }
    if (dto.entryType === TokenEntryType.CORRECTION && (amount === 0 || total + amount <= 0)) {
      throw new BadRequestException('A correction must change the fee and keep it above 0 Token');
    }
    return amount;
  }

  private assertInitial(status: MovieStatus, season: PricedSeason | null): number {
    assertProjectStatus(status, OPEN_PROJECT_STATUSES, 'allocate the production fee of a season');
    if (!season) throw new BadRequestException('Name the season to allocate (seasonId)');
    if (season.hasInitial) throw new ConflictException('This season was already allocated');
    if (season.episodeProductionCost <= 0n) throw new ConflictException('Set the episode price of the season first');
    const amount = baselineTokens(season.episodeProductionCost, season.episodeCount);
    if (amount <= 0) throw new ConflictException('The season has no episode to allocate for');
    return amount;
  }
}
