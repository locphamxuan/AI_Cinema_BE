import { ConflictException, Injectable } from '@nestjs/common';
import { type ContractStatus, EpisodeStatus, ProjectStatus, StudioMilestoneStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { OPEN_CONTRACT_STATUSES } from './contract-rounds';

/** The fields of a round its budget depends on. */
export interface BudgetedRound {
  projectId: string;
  handoffId: string | null;
  costVnd: bigint | null;
  /** The ceiling fixed when the first side of the round signed; null before (and on rounds signed before 24/11/2026). */
  ceilingVnd: bigint | null;
  status: ContractStatus;
}

/** A contract round that both sides just signed. */
export interface SignedRound {
  id: string;
  projectId: string;
  studioId: string;
  costVnd: bigint | null;
  /** Set from the start on a studio change: the hand-off waiting for this contract. */
  handoffId: string | null;
  adminSignedById: string | null;
  createdById: string;
}

/**
 * MF-1 §4 (07/11/2026): the studio may only start production once the contract carries both signatures. Signing
 * therefore hands the project off on the spot: a whole-project hand-off with the signed cost as its fee, already
 * IN_PROGRESS, the project IN_PRODUCTION and every episode waiting for the studio's film by its deadline.
 */
@Injectable()
export class ContractHandoffService {
  constructor(private readonly costs: ProductionCostService) {}

  /**
   * Throws unless the cost fits the budget left; call inside the signing transaction. The fee a waiting
   * hand-off already holds counts as available, since the signed cost replaces it.
   */
  async assertAffordable(tx: PrismaTx, projectId: string, costVnd: number, handoffId?: string | null): Promise<void> {
    return this.costs.assertAffordable(tx, projectId, costVnd - (await this.held(tx, handoffId)));
  }

  /**
   * The budget ceiling of a contract: the most its cost may be, i.e. the budget left plus the fee its waiting
   * hand-off already holds. This is the figure the studio sees on the unsigned template.
   */
  async ceiling(db: PrismaTx, projectId: string, handoffId?: string | null): Promise<number> {
    const { remainingVnd } = await this.costs.summary(projectId, db);
    return remainingVnd + (await this.held(db, handoffId));
  }

  /**
   * The budget ceiling of a round, as its copies print it and the studio sees it: the one fixed when its first side
   * signed; before that, the current ceiling while the round is open. Rounds closed before the ceiling was recorded
   * (24/11/2026) show their signed cost.
   */
  async budgetOf(db: PrismaTx, contract: BudgetedRound): Promise<number> {
    if (contract.ceilingVnd !== null) return Number(contract.ceilingVnd);
    if (!OPEN_CONTRACT_STATUSES.includes(contract.status) && contract.costVnd !== null) return Number(contract.costVnd);
    return this.ceiling(db, contract.projectId, contract.handoffId);
  }

  private async held(db: PrismaTx, handoffId?: string | null): Promise<number> {
    if (!handoffId) return 0;
    const handoff = await db.studioHandoff.findUniqueOrThrow({
      where: { id: handoffId },
      select: { offeredFeeVnd: true },
    });
    return Number(handoff.offeredFeeVnd);
  }

  async open(tx: PrismaTx, round: SignedRound): Promise<string> {
    if (round.handoffId) return this.start(tx, round, round.handoffId);
    const fee = Number(round.costVnd);
    await this.costs.assertAffordable(tx, round.projectId, fee);
    const actorId = round.adminSignedById ?? round.createdById;
    const { count } = await tx.movieProject.updateMany({
      where: { id: round.projectId, status: ProjectStatus.ASSIGNED },
      data: { status: ProjectStatus.IN_PRODUCTION, studioId: round.studioId, handedOffAt: new Date() },
    });
    if (count === 0) throw new ConflictException('The project is no longer waiting for its contract; reload it');
    const handoff = await tx.studioHandoff.create({
      data: {
        projectId: round.projectId,
        studioId: round.studioId,
        offeredFeeVnd: BigInt(fee),
        milestoneStatus: StudioMilestoneStatus.IN_PROGRESS,
        statusNote: 'Hợp đồng đã đủ chữ ký Admin và Studio',
        respondedAt: new Date(),
        createdById: actorId,
      },
    });
    await tx.studioMilestoneEvent.create({
      data: {
        handoffId: handoff.id,
        toStatus: StudioMilestoneStatus.IN_PROGRESS,
        note: 'Hợp đồng đã đủ chữ ký, Studio bắt đầu sản xuất',
        changedById: actorId,
      },
    });
    const episodes = await tx.episode.findMany({
      where: { movieId: round.projectId, status: EpisodeStatus.DRAFT },
      select: { id: true, deliveryDeadline: true },
    });
    for (const { id, deliveryDeadline } of episodes) {
      await tx.episode.update({
        where: { id },
        data: { dueDate: deliveryDeadline, status: EpisodeStatus.AWAITING_MEDIA },
      });
    }
    await tx.contract.update({ where: { id: round.id }, data: { handoffId: handoff.id } });
    return handoff.id;
  }

  /**
   * BR-59: the hand-off a studio change opened waits in BRIEF_SENT until its contract is signed; production starts
   * now, with the signed cost as its fee. The project is already in production, so it stays as it is.
   */
  private async start(tx: PrismaTx, round: SignedRound, handoffId: string): Promise<string> {
    const fee = Number(round.costVnd);
    await this.assertAffordable(tx, round.projectId, fee, handoffId);
    const actorId = round.adminSignedById ?? round.createdById;
    const { count } = await tx.studioHandoff.updateMany({
      where: { id: handoffId, milestoneStatus: StudioMilestoneStatus.BRIEF_SENT },
      data: {
        offeredFeeVnd: BigInt(fee),
        milestoneStatus: StudioMilestoneStatus.IN_PROGRESS,
        statusNote: 'Hợp đồng đã đủ chữ ký Admin và Studio',
        respondedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('The hand-off of this contract is no longer waiting; reload it');
    await tx.studioMilestoneEvent.create({
      data: {
        handoffId,
        fromStatus: StudioMilestoneStatus.BRIEF_SENT,
        toStatus: StudioMilestoneStatus.IN_PROGRESS,
        note: 'Hợp đồng đã đủ chữ ký, Studio bắt đầu sản xuất',
        changedById: actorId,
      },
    });
    return handoffId;
  }
}
