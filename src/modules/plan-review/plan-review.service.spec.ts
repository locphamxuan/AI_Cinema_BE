import { ConflictException } from '@nestjs/common';
import { PlanReviewField, PlanReviewStatus, ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PlanReviewService } from './plan-review.service';

type Review = {
  id: string;
  field: PlanReviewField;
  sceneId: string | null;
  status: PlanReviewStatus;
  decidedAt: Date | null;
};

const review = (
  id: string,
  field: PlanReviewField,
  status: PlanReviewStatus,
  sceneId: string | null = null,
): Review => ({
  id,
  field,
  sceneId,
  status,
  decidedAt: status === PlanReviewStatus.PENDING ? null : new Date(),
});

describe('PlanReviewService', () => {
  const tx = {
    planReview: { create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    productionPlan: { update: jest.fn() },
    scene: { update: jest.fn(), updateMany: jest.fn() },
    submission: { updateMany: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    planReview: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new PlanReviewService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.planReview.create.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));
    tx.planReview.updateMany.mockResolvedValue({ count: 1 });
  });

  it('opens a round with one review per scene plus the three plan fields (BR-39)', async () => {
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      status: ProductionPlanStatus.SUBMITTED,
      scenes: [{ id: 's1' }, { id: 's2' }],
    });
    prisma.planReview.findFirst.mockResolvedValue(null);

    const reviews = (await service.create('plan-id', {}, 'reviewer-id')) as unknown as Review[];

    expect(reviews.map((r) => [r.field, r.sceneId])).toEqual([
      [PlanReviewField.SCENE, 's1'],
      [PlanReviewField.SCENE, 's2'],
      [PlanReviewField.OVERALL_SCRIPT, null],
      [PlanReviewField.DURATION, null],
      [PlanReviewField.TOKEN_ESTIMATE, null],
    ]);
    expect(tx.productionPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-id' },
      data: { status: ProductionPlanStatus.UNDER_REVIEW },
    });
  });

  it('refuses a second round while one is still open', async () => {
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      status: ProductionPlanStatus.SUBMITTED,
      scenes: [{ id: 's1' }],
    });
    prisma.planReview.findFirst.mockResolvedValue({ id: 'open' });

    await expect(service.create('plan-id', {}, 'reviewer-id')).rejects.toThrow(ConflictException);
  });

  describe('decide', () => {
    beforeEach(() => {
      prisma.planReview.findUnique.mockResolvedValue({
        id: 'r-token',
        productionPlanId: 'plan-id',
        status: PlanReviewStatus.PENDING,
        productionPlan: { status: ProductionPlanStatus.UNDER_REVIEW },
      });
    });

    const planStatusAfter = () =>
      (tx.productionPlan.update.mock.calls as [{ data: { status: ProductionPlanStatus } }][]).at(-1)?.[0].data.status;

    it('keeps the plan under review until every target is decided', async () => {
      tx.planReview.findMany.mockResolvedValue([
        review('r-s1', PlanReviewField.SCENE, PlanReviewStatus.CHANGES_REQUESTED, 's1'),
        review('r-token', PlanReviewField.TOKEN_ESTIMATE, PlanReviewStatus.PENDING),
      ]);

      await service.decide('r-token', { decision: PlanReviewStatus.CHANGES_REQUESTED });

      expect(planStatusAfter()).toBe(ProductionPlanStatus.UNDER_REVIEW);
    });

    it('sends the plan back when a plan field is flagged even though every scene passed', async () => {
      tx.planReview.findMany.mockResolvedValue([
        review('r-s1', PlanReviewField.SCENE, PlanReviewStatus.APPROVED, 's1'),
        review('r-script', PlanReviewField.OVERALL_SCRIPT, PlanReviewStatus.APPROVED),
        review('r-token', PlanReviewField.TOKEN_ESTIMATE, PlanReviewStatus.CHANGES_REQUESTED),
      ]);

      await service.decide('r-token', { decision: PlanReviewStatus.CHANGES_REQUESTED });

      expect(planStatusAfter()).toBe(ProductionPlanStatus.CHANGES_REQUESTED);
      expect(tx.scene.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: SceneStatus.APPROVED } });
    });

    it('approves the plan when the latest review of every target is approved', async () => {
      tx.planReview.findMany.mockResolvedValue([
        review('old', PlanReviewField.SCENE, PlanReviewStatus.CHANGES_REQUESTED, 's1'),
        review('r-s1', PlanReviewField.SCENE, PlanReviewStatus.APPROVED, 's1'),
        review('r-token', PlanReviewField.TOKEN_ESTIMATE, PlanReviewStatus.APPROVED),
      ]);

      await service.decide('r-token', { decision: PlanReviewStatus.APPROVED });

      expect(planStatusAfter()).toBe(ProductionPlanStatus.APPROVED);
    });

    it('changes nothing when another Reviewer decided the row first', async () => {
      tx.planReview.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.decide('r-token', { decision: PlanReviewStatus.APPROVED })).rejects.toThrow(
        'already been decided',
      );
      expect(tx.productionPlan.update).not.toHaveBeenCalled();
    });
  });
});
