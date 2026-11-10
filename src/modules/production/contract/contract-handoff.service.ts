import { ConflictException, Injectable } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, StudioMilestoneStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';

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
    const held = handoffId
      ? await tx.studioHandoff.findUniqueOrThrow({ where: { id: handoffId }, select: { offeredFeeVnd: true } })
      : null;
    return this.costs.assertAffordable(tx, projectId, costVnd - Number(held?.offeredFeeVnd ?? 0));
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
