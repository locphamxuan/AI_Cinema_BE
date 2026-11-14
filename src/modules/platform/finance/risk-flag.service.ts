import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionFlagStatus } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { RISK_RULES } from './risk-rules';

/** How far back a scan looks; flags are unique per rule and row, so overlapping scans add nothing twice. */
export const RISK_SCAN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * MF-5 Analytics / Risk / Oversight, Admin only: the risk rules read the Coin ledger and flag suspicious rows;
 * the Admin then confirms a flag (and corrects the wallet through the usual Coin adjustment) or dismisses it.
 */
@Injectable()
export class RiskFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  rules() {
    return RISK_RULES.map(({ code, description }) => ({ code, description }));
  }

  /** Runs every rule over the lookback window; returns how many new flags were raised. */
  async scan(now = new Date()): Promise<{ created: number }> {
    const since = new Date(now.getTime() - RISK_SCAN_LOOKBACK_MS);
    let created = 0;
    for (const rule of RISK_RULES) {
      const hits = await this.prisma.$queryRaw<{ id: string; reason: string }[]>(rule.query(since));
      if (!hits.length) continue;
      const { count } = await this.prisma.transactionFlag.createMany({
        data: hits.map((hit) => ({ coinTransactionId: hit.id, ruleCode: rule.code, reason: hit.reason })),
        skipDuplicates: true,
      });
      created += count;
    }
    return { created };
  }

  list(query: PaginateQuery) {
    return paginate(query, this.prisma.transactionFlag, {
      relations: {
        coinTransaction: {
          select: {
            id: true,
            entryType: true,
            mainAmount: true,
            bonusAmount: true,
            rateVnd: true,
            createdAt: true,
            wallet: { select: { id: true, user: { select: { id: true, fullName: true, email: true } } } },
          },
        },
        reviewedBy: { select: { id: true, fullName: true } },
      },
      sortableColumns: ['createdAt', 'status', 'ruleCode'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'], ruleCode: ['$eq', '$in'] },
    });
  }

  async review(
    flagId: string,
    decision: 'CONFIRMED' | 'DISMISSED',
    note: string | undefined,
    admin: AuthenticatedUser,
  ) {
    const flag = await this.prisma.transactionFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Flag not found');
    if (flag.status !== TransactionFlagStatus.OPEN) throw new ConflictException(`The flag is already ${flag.status}`);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transactionFlag.updateMany({
        where: { id: flagId, status: TransactionFlagStatus.OPEN },
        data: { status: decision, reviewNote: note?.trim() || null, reviewedById: admin.id, reviewedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The flag changed meanwhile; reload it');
      await this.audit.record(
        {
          action: CONTENT_EVENT.TRANSACTION_FLAG_REVIEWED,
          entityType: 'TransactionFlag',
          entityId: flagId,
          projectId: null,
          actorId: admin.id,
          payload: { decision, ruleCode: flag.ruleCode, coinTransactionId: flag.coinTransactionId },
        },
        tx,
      );
      return tx.transactionFlag.findUniqueOrThrow({ where: { id: flagId } });
    });
  }
}
