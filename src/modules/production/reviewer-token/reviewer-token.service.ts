import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReviewerTokenEntryType, type TokenEntryType, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { AddReviewerTokenEntryRequestDto } from './dto/reviewer-token.request.dto';

const HISTORY_LIMIT = 200;

const FEE_ENTRY_LABEL: Record<TokenEntryType, string> = {
  INITIAL: 'Cấp phí lần đầu',
  TOP_UP: 'Cấp thêm',
  CORRECTION: 'Điều chỉnh',
};

export interface TokenBalance {
  /** Granted minus taken back by the Admin. */
  grantedTokens: number;
  /** Production fees the Reviewer allocated (corrections included). */
  allocatedTokens: number;
  balanceTokens: number;
}

/**
 * Token budget of each Reviewer: the Admin grants it (or takes back what is left), the Reviewer spends it on
 * production fees. Both sides are append-only ledgers, so the balance is always a sum, never a stored figure.
 */
@Injectable()
export class ReviewerTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly notifications: NotificationService,
  ) {}

  /** Inside a transaction, call lockReviewer first so the figure cannot change before it is used. */
  async balance(reviewerId: string, tx?: PrismaTx): Promise<TokenBalance> {
    const db = tx ?? this.prisma;
    const [granted, allocated] = await Promise.all([
      db.reviewerTokenEntry.aggregate({ where: { reviewerId }, _sum: { amountTokens: true } }),
      db.tokenLedgerEntry.aggregate({ where: { createdById: reviewerId }, _sum: { amountTokens: true } }),
    ]);
    const grantedTokens = Number(granted._sum.amountTokens ?? 0n);
    const allocatedTokens = Number(allocated._sum.amountTokens ?? 0n);
    return { grantedTokens, allocatedTokens, balanceTokens: grantedTokens - allocatedTokens };
  }

  /** Spending `amount` (a production fee) must stay within the Reviewer's balance; returning Token never fails. */
  async assertCanSpend(tx: PrismaTx, reviewerId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.lockReviewer(tx, reviewerId);
    const { balanceTokens } = await this.balance(reviewerId, tx);
    if (balanceTokens < amount) {
      throw new ConflictException(
        `Not enough Token: ${balanceTokens} left, ${amount} needed. Ask the Admin to grant more.`,
      );
    }
  }

  /** Every active Admin learns that a Reviewer put budget into (or took it out of) a project. */
  async notifyAllocation(
    tx: PrismaTx,
    entry: { reviewer: AuthenticatedUser; movie: { id: string; title: string }; type: TokenEntryType; amount: number },
  ): Promise<void> {
    const admins = await tx.user.findMany({ where: { role: UserRole.ADMIN, isActive: true }, select: { id: true } });
    const reviewer = await tx.user.findUniqueOrThrow({ where: { id: entry.reviewer.id }, select: { fullName: true } });
    const { balanceTokens } = await this.balance(entry.reviewer.id, tx);
    await this.notifications.notify(
      admins.map((a) => a.id),
      {
        type: NOTIFICATION_TYPE.TOKEN_ALLOCATED,
        title: `${reviewer.fullName} cấp ${entry.amount} Token cho phim "${entry.movie.title}"`,
        body: `${FEE_ENTRY_LABEL[entry.type]}. ${reviewer.fullName} còn ${balanceTokens} Token.`,
        link: `/projects/${entry.movie.id}/fee`,
        payload: { movieId: entry.movie.id, reviewerId: entry.reviewer.id, amountTokens: entry.amount, balanceTokens },
      },
      tx,
    );
  }

  /** The Reviewer's balance and history: grants, take-backs and fees, newest first. */
  async wallet(reviewerId: string) {
    const reviewer = await this.reviewer(reviewerId);
    const [totals, budget, fees, { tokenRateVnd }] = await Promise.all([
      this.balance(reviewerId),
      this.prisma.reviewerTokenEntry.findMany({
        where: { reviewerId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { createdBy: { select: { id: true, fullName: true } } },
      }),
      this.prisma.tokenLedgerEntry.findMany({
        where: { createdById: reviewerId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { movie: { select: { id: true, title: true } } },
      }),
      this.settings.get(),
    ]);
    const history = [
      ...budget.map((e) => ({
        id: e.id,
        kind: e.entryType,
        // Seen from the Reviewer's wallet: what came in (+) or went out (−).
        amountTokens: Number(e.amountTokens),
        rateVnd: e.rateVnd,
        reason: e.reason,
        createdAt: e.createdAt,
        by: e.createdBy,
        movie: null,
        feeEntryType: null,
      })),
      ...fees.map((e) => ({
        id: e.id,
        kind: 'ALLOCATION' as const,
        amountTokens: -Number(e.amountTokens),
        rateVnd: e.rateVnd,
        reason: e.reason,
        createdAt: e.createdAt,
        by: null,
        movie: e.movie,
        feeEntryType: e.entryType,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, HISTORY_LIMIT);
    return { reviewer, ...totals, tokenRateVnd, history };
  }

  /** Every Reviewer with granted, allocated and remaining Token, for the Admin. */
  async reviewers() {
    const reviewers = await this.prisma.user.findMany({
      where: { role: UserRole.CONTENT_REVIEWER },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true, isActive: true },
    });
    const ids = reviewers.map((r) => r.id);
    const [granted, allocated] = await Promise.all([
      this.prisma.reviewerTokenEntry.groupBy({
        by: ['reviewerId'],
        where: { reviewerId: { in: ids } },
        _sum: { amountTokens: true },
      }),
      this.prisma.tokenLedgerEntry.groupBy({
        by: ['createdById'],
        where: { createdById: { in: ids } },
        _sum: { amountTokens: true },
      }),
    ]);
    const grantedBy = new Map(granted.map((g) => [g.reviewerId, Number(g._sum.amountTokens ?? 0n)]));
    const allocatedBy = new Map(allocated.map((a) => [a.createdById, Number(a._sum.amountTokens ?? 0n)]));
    return reviewers.map((r) => {
      const grantedTokens = grantedBy.get(r.id) ?? 0;
      const allocatedTokens = allocatedBy.get(r.id) ?? 0;
      return { ...r, grantedTokens, allocatedTokens, balanceTokens: grantedTokens - allocatedTokens };
    });
  }

  /** The Admin grants Token, or takes back part of what the Reviewer has not allocated yet. */
  async addEntry(reviewerId: string, dto: AddReviewerTokenEntryRequestDto, admin: AuthenticatedUser) {
    const reason = dto.reason?.trim() || null;
    const revoke = dto.entryType === ReviewerTokenEntryType.REVOKE;
    if (revoke && !reason) throw new BadRequestException('Taking Token back needs a reason');
    await this.reviewer(reviewerId);
    const { tokenRateVnd } = await this.settings.get();

    await this.prisma.$transaction(async (tx) => {
      await this.lockReviewer(tx, reviewerId);
      if (revoke) {
        const { balanceTokens } = await this.balance(reviewerId, tx);
        if (dto.amountTokens > balanceTokens) {
          throw new ConflictException(`Only ${balanceTokens} Token are left to take back`);
        }
      }
      await tx.reviewerTokenEntry.create({
        data: {
          reviewerId,
          entryType: dto.entryType,
          amountTokens: BigInt(revoke ? -dto.amountTokens : dto.amountTokens),
          rateVnd: tokenRateVnd,
          reason,
          createdById: admin.id,
        },
      });
      await this.notifications.notify(
        [reviewerId],
        {
          type: revoke ? NOTIFICATION_TYPE.TOKEN_REVOKED : NOTIFICATION_TYPE.TOKEN_GRANTED,
          title: revoke ? `Admin thu hồi ${dto.amountTokens} Token` : `Bạn được cấp ${dto.amountTokens} Token`,
          body: reason ?? 'Admin cấp để chi phí sản xuất phim.',
          link: '/tokens',
          payload: { amountTokens: dto.amountTokens },
        },
        tx,
      );
    });
    return this.wallet(reviewerId);
  }

  private async reviewer(reviewerId: string) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (reviewer?.role !== UserRole.CONTENT_REVIEWER) throw new NotFoundException('Reviewer not found');
    return { id: reviewer.id, fullName: reviewer.fullName, email: reviewer.email };
  }

  /** Budget changes of one Reviewer (fees and Admin entries) are serialised on the user row. */
  private async lockReviewer(tx: PrismaTx, reviewerId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${reviewerId}::uuid FOR UPDATE`;
  }
}
