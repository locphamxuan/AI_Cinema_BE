import { ConflictException } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, StudioMilestoneStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { ContractHandoffService, type SignedRound } from './contract-handoff.service';

const ROUND: SignedRound = {
  id: 'c2',
  projectId: 'p1',
  studioId: 's1',
  costVnd: 50_000_000n,
  handoffId: null,
  adminSignedById: 'admin',
  createdById: 'creator-of-round',
};

describe('ContractHandoffService', () => {
  const tx = {
    movieProject: { updateMany: jest.fn() },
    studioHandoff: { create: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    studioMilestoneEvent: { create: jest.fn() },
    episode: { findMany: jest.fn(), update: jest.fn() },
    contract: { update: jest.fn() },
  };
  const costs = { assertAffordable: jest.fn() };
  const service = new ContractHandoffService(costs as unknown as ProductionCostService);
  const run = (round: SignedRound = ROUND) => service.open(tx as unknown as PrismaTx, round);

  beforeEach(() => {
    jest.clearAllMocks();
    costs.assertAffordable.mockResolvedValue(undefined);
    tx.movieProject.updateMany.mockResolvedValue({ count: 1 });
    tx.studioHandoff.create.mockResolvedValue({ id: 'h1' });
    tx.episode.findMany.mockResolvedValue([]);
    tx.studioHandoff.findUniqueOrThrow.mockResolvedValue({ offeredFeeVnd: 30_000_000n });
    tx.studioHandoff.updateMany.mockResolvedValue({ count: 1 });
  });

  it('delegates the budget check to the production cost ledger', async () => {
    await service.assertAffordable(tx as unknown as PrismaTx, 'p1', 1_000);
    expect(costs.assertAffordable).toHaveBeenCalledWith(tx, 'p1', 1_000);
    expect(tx.studioHandoff.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('hands the whole project to the studio at the signed cost, already in progress', async () => {
    const deadline = new Date('2026-12-01T00:00:00Z');
    tx.episode.findMany.mockResolvedValue([
      { id: 'e1', deliveryDeadline: deadline },
      { id: 'e2', deliveryDeadline: null },
    ]);

    await expect(run()).resolves.toBe('h1');

    expect(costs.assertAffordable).toHaveBeenCalledWith(tx, 'p1', 50_000_000);
    expect(tx.movieProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: ProjectStatus.ASSIGNED },
      data: expect.objectContaining({ status: ProjectStatus.IN_PRODUCTION, studioId: 's1' }),
    });
    expect(tx.studioHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'p1',
        studioId: 's1',
        offeredFeeVnd: 50_000_000n,
        milestoneStatus: StudioMilestoneStatus.IN_PROGRESS,
        createdById: 'admin',
      }),
    });
    expect(tx.studioMilestoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        handoffId: 'h1',
        toStatus: StudioMilestoneStatus.IN_PROGRESS,
        changedById: 'admin',
      }),
    });
    expect(tx.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { movieId: 'p1', status: EpisodeStatus.DRAFT } }),
    );
    expect(tx.episode.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'e1' },
      data: { dueDate: deadline, status: EpisodeStatus.AWAITING_MEDIA },
    });
    expect(tx.episode.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'e2' },
      data: { dueDate: null, status: EpisodeStatus.AWAITING_MEDIA },
    });
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { handoffId: 'h1' } });
  });

  it('credits the round author when no Admin signature is recorded', async () => {
    await run({ ...ROUND, adminSignedById: null });
    expect(tx.studioHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ createdById: 'creator-of-round' }),
    });
  });

  it('refuses a project that is no longer waiting for its contract', async () => {
    tx.movieProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(run()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.studioHandoff.create).not.toHaveBeenCalled();
  });

  it('stops before touching the project when the cost no longer fits the budget', async () => {
    costs.assertAffordable.mockRejectedValue(new ConflictException('over budget'));
    await expect(run()).rejects.toThrow('over budget');
    expect(tx.movieProject.updateMany).not.toHaveBeenCalled();
  });

  describe('after a studio change', () => {
    const CHANGED: SignedRound = { ...ROUND, studioId: 's2', handoffId: 'h2' };

    it('counts the fee the waiting hand-off holds as available', async () => {
      await service.assertAffordable(tx as unknown as PrismaTx, 'p1', 50_000_000, 'h2');
      expect(tx.studioHandoff.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'h2' },
        select: { offeredFeeVnd: true },
      });
      expect(costs.assertAffordable).toHaveBeenCalledWith(tx, 'p1', 20_000_000);
    });

    it('starts the waiting hand-off at the signed cost instead of opening another one', async () => {
      await expect(run(CHANGED)).resolves.toBe('h2');

      expect(costs.assertAffordable).toHaveBeenCalledWith(tx, 'p1', 20_000_000);
      expect(tx.studioHandoff.updateMany).toHaveBeenCalledWith({
        where: { id: 'h2', milestoneStatus: StudioMilestoneStatus.BRIEF_SENT },
        data: expect.objectContaining({
          offeredFeeVnd: 50_000_000n,
          milestoneStatus: StudioMilestoneStatus.IN_PROGRESS,
        }),
      });
      expect(tx.studioMilestoneEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          handoffId: 'h2',
          fromStatus: StudioMilestoneStatus.BRIEF_SENT,
          toStatus: StudioMilestoneStatus.IN_PROGRESS,
          changedById: 'admin',
        }),
      });
      // The project is already in production and its episodes keep their state.
      expect(tx.movieProject.updateMany).not.toHaveBeenCalled();
      expect(tx.studioHandoff.create).not.toHaveBeenCalled();
      expect(tx.episode.update).not.toHaveBeenCalled();
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('refuses when the hand-off is no longer waiting', async () => {
      tx.studioHandoff.updateMany.mockResolvedValue({ count: 0 });
      await expect(run(CHANGED)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.studioMilestoneEvent.create).not.toHaveBeenCalled();
    });
  });
});
