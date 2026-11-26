import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionFlagStatus, UserRole } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { UserService } from 'src/modules/identity/user/user.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { FlagDecision } from './dto/finance.request.dto';
import { RISK_RULES } from './risk-rules';

/** How far back a scan looks; flags are unique per rule and row, so overlapping scans add nothing twice. */
export const RISK_SCAN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** The Admin screen a risk notification opens. */
export const RISK_FLAGS_LINK = '/admin/finance?tab=risk';

export const RISK_REASON = {
  NOT_A_MEMBER: 'RISK_FLAG_NOT_A_MEMBER',
} as const;

/** What one scan found: the new flags in all, and per rule that raised any. */
export interface RiskScanResult {
  created: number;
  rules: { code: string; description: string; created: number }[];
}

/**
 * MF-5 Analytics / Risk / Oversight, Admin only: the risk rules read the Coin ledger and flag suspicious rows.
 * The Admin then stops the behaviour by locking the member account straight from the flag (every session is
 * signed out), or dismisses the flag. Who acted, when and why stays on the flag and in the audit log.
 */
@Injectable()
export class RiskFlagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly users: UserService,
    private readonly notifications: NotificationService,
  ) {}

  rules() {
    return RISK_RULES.map(({ code, description }) => ({ code, description }));
  }

  /** Runs every rule over the lookback window; answers how many new flags each rule raised. */
  async scan(now = new Date()): Promise<RiskScanResult> {
    const since = new Date(now.getTime() - RISK_SCAN_LOOKBACK_MS);
    const result: RiskScanResult = { created: 0, rules: [] };
    for (const rule of RISK_RULES) {
      const hits = await this.prisma.$queryRaw<{ id: string; reason: string }[]>(rule.query(since));
      if (!hits.length) continue;
      const { count } = await this.prisma.transactionFlag.createMany({
        data: hits.map((hit) => ({ coinTransactionId: hit.id, ruleCode: rule.code, reason: hit.reason })),
        skipDuplicates: true,
      });
      if (count === 0) continue;
      result.created += count;
      result.rules.push({ code: rule.code, description: rule.description, created: count });
    }
    return result;
  }

  /** The scheduled scan: nobody is watching the screen, so the Admins get an in-app notification of new flags. */
  async scanAndNotify(now = new Date()): Promise<RiskScanResult> {
    const result = await this.scan(now);
    if (result.created > 0) {
      await this.notifications.notify(await this.notifications.adminIds(), {
        type: NOTIFICATION_TYPE.RISK_FLAGS_FOUND,
        title: `Phát hiện ${result.created} giao dịch rủi ro mới`,
        body: result.rules.map((rule) => `${rule.description}: ${rule.created}`).join('. '),
        link: RISK_FLAGS_LINK,
        payload: { created: result.created, rules: result.rules.map((rule) => rule.code) },
      });
    }
    return result;
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
            wallet: {
              select: { id: true, user: { select: { id: true, fullName: true, email: true, isActive: true } } },
            },
          },
        },
        reviewedBy: { select: { id: true, fullName: true } },
      },
      sortableColumns: ['createdAt', 'status', 'ruleCode'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'], ruleCode: ['$eq', '$in'] },
    });
  }

  /**
   * Closes an open flag. ACCOUNT_LOCKED also locks the member account in the same transaction, then signs it
   * out everywhere with the sign-out the accounts screen uses; the Admin unlocks the account there later.
   */
  async review(flagId: string, decision: FlagDecision, note: string | undefined, admin: AuthenticatedUser) {
    const flag = await this.prisma.transactionFlag.findUnique({
      where: { id: flagId },
      include: { coinTransaction: { select: { wallet: { select: { user: true } } } } },
    });
    if (!flag) throw new NotFoundException('Flag not found');
    if (flag.status !== TransactionFlagStatus.OPEN) throw new ConflictException(`The flag is already ${flag.status}`);
    const member = flag.coinTransaction.wallet.user;
    const locking = decision === TransactionFlagStatus.ACCOUNT_LOCKED;
    if (locking && member.role !== UserRole.MEMBER) {
      throw new ConflictException({
        message: 'Only a member account can be locked from a risk flag',
        details: { reason: RISK_REASON.NOT_A_MEMBER },
      });
    }
    const reviewNote = note?.trim() || null;
    const reviewed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transactionFlag.updateMany({
        where: { id: flagId, status: TransactionFlagStatus.OPEN },
        data: { status: decision, reviewNote, reviewedById: admin.id, reviewedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The flag changed meanwhile; reload it');
      if (locking) await tx.user.update({ where: { id: member.id }, data: { isActive: false } });
      await this.audit.record(
        {
          action: CONTENT_EVENT.TRANSACTION_FLAG_REVIEWED,
          entityType: 'TransactionFlag',
          entityId: flagId,
          projectId: null,
          actorId: admin.id,
          payload: {
            decision,
            ruleCode: flag.ruleCode,
            coinTransactionId: flag.coinTransactionId,
            userId: member.id,
            note: reviewNote,
            ...(locking ? { accountWasActive: member.isActive } : {}),
          },
        },
        tx,
      );
      return tx.transactionFlag.findUniqueOrThrow({ where: { id: flagId } });
    });
    if (locking) await this.users.signOutEverywhere(member.id);
    return reviewed;
  }
}
