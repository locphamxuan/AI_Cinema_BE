import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ProductionCostEntryType, ProjectStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService, type TitledProject } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { type CostSummary, summariseCost } from './cost-summary';
import type { AddCostEntryRequestDto } from './dto/add-cost-entry.request.dto';

const vnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/**
 * Production cost of a movie in VND (BR-45, BR-46): an append-only ledger whose sum is the budget. The Admin
 * sets the budget when the project is ideated and corrects it with a reason; more cost is granted only on a
 * Reviewer's request (cost-request). Hand-offs commit their offered fee against the budget, so a new fee can
 * never exceed what is left. Every write locks the project row, so two fees cannot both take the last VND.
 */
@Injectable()
export class ProductionCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async summary(projectId: string, tx?: PrismaTx): Promise<CostSummary> {
    const db = tx ?? this.prisma;
    const [entries, handoffs] = await Promise.all([
      db.productionCostEntry.aggregate({ where: { projectId }, _sum: { amountVnd: true } }),
      db.studioHandoff.findMany({
        where: { projectId },
        select: { milestoneStatus: true, offeredFeeVnd: true, forfeitedVnd: true },
      }),
    ]);
    return summariseCost(Number(entries._sum.amountVnd ?? 0n), handoffs);
  }

  /** True once the Admin set the budget (BR-12). */
  async isFunded(projectId: string, tx?: PrismaTx): Promise<boolean> {
    const budgets = await (tx ?? this.prisma).productionCostEntry.count({
      where: { projectId, entryType: ProductionCostEntryType.BUDGET },
    });
    return budgets > 0;
  }

  /** Serialises the cost writes of one project until the transaction ends. */
  async lock(tx: PrismaTx, projectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM movie_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
  }

  /** Locks the project and refuses a fee above the budget left. Call inside the transaction that commits it. */
  async assertAffordable(tx: PrismaTx, projectId: string, feeVnd: number): Promise<void> {
    await this.lock(tx, projectId);
    const { remainingVnd } = await this.summary(projectId, tx);
    if (feeVnd > remainingVnd) {
      throw new ConflictException(
        `The fee (${vnd(feeVnd)}) is more than the budget left (${vnd(remainingVnd)}); ask the Admin for more production cost`,
      );
    }
  }

  async ledger(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    const entries = await this.prisma.productionCostEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        request: { select: { id: true, requestedVnd: true, studioQuoteVnd: true } },
      },
    });
    return { ...(await this.summary(projectId)), entries };
  }

  /** The Admin sets the budget once, then corrects it with a reason; it never drops below what is committed. */
  async addEntry(projectId: string, dto: AddCostEntryRequestDto, user: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, projectId);
      const project = await this.access.project(projectId, user, 'read', tx);
      assertProjectStatus(
        project.status,
        [...OPEN_PROJECT_STATUSES, ProjectStatus.UNDER_REVISION],
        'change the production budget',
      );
      const reason = await this.assertEntry(tx, projectId, dto);
      const entry = await tx.productionCostEntry.create({
        data: { projectId, entryType: dto.entryType, amountVnd: BigInt(dto.amountVnd), reason, createdById: user.id },
      });
      const isBudget = dto.entryType === ProductionCostEntryType.BUDGET;
      await this.record(tx, {
        action: isBudget ? CONTENT_EVENT.COST_BUDGET_SET : CONTENT_EVENT.COST_CORRECTED,
        entryId: entry.id,
        projectId,
        actorId: user.id,
        payload: { amountVnd: dto.amountVnd, reason },
      });
      await this.notifyReviewer(tx, project, {
        title: isBudget
          ? `Admin đặt ngân sách sản xuất ${vnd(dto.amountVnd)} cho phim "${project.movie.title}"`
          : `Admin điều chỉnh ngân sách sản xuất phim "${project.movie.title}" ${dto.amountVnd > 0 ? '+' : ''}${vnd(dto.amountVnd)}`,
        body: reason ?? undefined,
      });
    });
    return this.ledger(projectId, user);
  }

  /** Books what the Admin granted on a cost request, inside the transaction that approves it. */
  async grant(
    tx: PrismaTx,
    request: { id: string; projectId: string },
    amountVnd: number,
    reason: string,
    actorId: string,
  ) {
    const entry = await tx.productionCostEntry.create({
      data: {
        projectId: request.projectId,
        entryType: ProductionCostEntryType.ADDITIONAL,
        amountVnd: BigInt(amountVnd),
        reason,
        requestId: request.id,
        createdById: actorId,
      },
    });
    await this.record(tx, {
      action: CONTENT_EVENT.COST_ADDED,
      entryId: entry.id,
      projectId: request.projectId,
      actorId,
      payload: { amountVnd, requestId: request.id },
    });
  }

  /** Returns the trimmed reason once the entry is allowed. */
  private async assertEntry(tx: PrismaTx, projectId: string, dto: AddCostEntryRequestDto): Promise<string | null> {
    const funded = await this.isFunded(projectId, tx);
    const reason = dto.reason?.trim() || null;
    if (dto.entryType === ProductionCostEntryType.BUDGET) {
      if (funded) throw new ConflictException('The budget was already set; correct it instead');
      if (dto.amountVnd <= 0) throw new BadRequestException('The budget must be above 0 VND');
      return reason;
    }
    if (!funded) throw new ConflictException('Set the budget first');
    if (!reason) throw new BadRequestException('A correction needs a reason (BR-46)');
    if (dto.amountVnd === 0) throw new BadRequestException('A correction must change the budget');
    const { budgetVnd, committedVnd } = await this.summary(projectId, tx);
    const next = budgetVnd + dto.amountVnd;
    if (next <= 0 || next < committedVnd) {
      throw new BadRequestException(
        `The budget would be ${vnd(next)}: it must stay above 0 and cover the ${vnd(committedVnd)} already committed to studios`,
      );
    }
    return reason;
  }

  private record(
    tx: PrismaTx,
    event: {
      action: ContentEvent;
      entryId: string;
      projectId: string;
      actorId: string;
      payload: Record<string, unknown>;
    },
  ) {
    return this.auditLog.record(
      {
        action: event.action,
        entityType: 'ProductionCostEntry',
        entityId: event.entryId,
        projectId: event.projectId,
        actorId: event.actorId,
        payload: event.payload,
      },
      tx,
    );
  }

  private notifyReviewer(tx: PrismaTx, project: TitledProject, message: { title: string; body?: string }) {
    return this.notifications.notify(
      [project.reviewerId],
      {
        type: NOTIFICATION_TYPE.COST_BUDGET_CHANGED,
        ...message,
        link: `/projects/${project.id}/fee`,
        payload: { projectId: project.id },
      },
      tx,
    );
  }
}
