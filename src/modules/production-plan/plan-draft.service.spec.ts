import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PlanDraftService } from './plan-draft.service';
import type { SavePlanDraftRequestDto } from './dto/save-plan-draft.request.dto';

describe('PlanDraftService.save', () => {
  const tx = {
    scene: { deleteMany: jest.fn(), createMany: jest.fn() },
    productionPlan: { update: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    scene: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new PlanDraftService(prisma as unknown as PrismaService);

  const givenPlan = (status: ProductionPlanStatus = ProductionPlanStatus.DRAFT) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      status,
      scenes: [{ id: '11111111-1111-4111-8111-111111111111' }, { id: '22222222-2222-4222-8222-222222222222' }],
      productionProject: { status: 'ACTIVE' },
    });
  const draft = (scenes: SavePlanDraftRequestDto['scenes']): SavePlanDraftRequestDto => ({
    scriptText: 'Kịch bản tập 2',
    targetDurationSeconds: 900,
    estimatedAiResourceUsage: 120,
    scenes,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    givenPlan();
  });

  it('deletes dropped scenes, updates kept ones in bulk and adds new ones, all in one transaction', async () => {
    await service.save(
      'plan-id',
      draft([
        { id: '22222222-2222-4222-8222-222222222222', sceneNumber: 1, title: 'Giữ lại', targetDurationSeconds: 40 },
        { sceneNumber: 2, title: 'Cảnh mới', description: 'Mới', targetDurationSeconds: 20, estimatedTokens: 60 },
      ]),
    );

    expect(tx.scene.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['11111111-1111-4111-8111-111111111111'] } },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.scene.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ productionPlanId: 'plan-id', sceneNumber: 2, title: 'Cảnh mới', scriptText: 'Mới' }),
      ],
    });
    expect(tx.productionPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-id' },
      data: {
        scriptText: 'Kịch bản tập 2',
        targetDurationSeconds: 900,
        estimatedAiResourceUsage: 120,
        totalSceneCount: 2,
      },
    });
  });

  it('keeps an over-long draft: the duration rules apply when the plan is submitted', async () => {
    await expect(
      service.save('plan-id', draft([{ sceneNumber: 1, title: 'Dài', targetDurationSeconds: 99_999 }])),
    ).resolves.toEqual([]);
  });

  it.each([
    [
      'a scene of another plan',
      [{ id: '33333333-3333-4333-8333-333333333333', sceneNumber: 1, title: 'x', targetDurationSeconds: 5 }],
    ],
    [
      'two scenes with the same number',
      [
        { sceneNumber: 1, title: 'a', targetDurationSeconds: 5 },
        { sceneNumber: 1, title: 'b', targetDurationSeconds: 5 },
      ],
    ],
  ])('refuses %s', async (_case, scenes) => {
    await expect(service.save('plan-id', draft(scenes))).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a plan already under review', async () => {
    givenPlan(ProductionPlanStatus.SUBMITTED);
    await expect(service.save('plan-id', draft([]))).rejects.toThrow(ConflictException);
  });
});
