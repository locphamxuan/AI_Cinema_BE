import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from 'src/modules/production-project/production-project.service';
import { ProductionPlanService } from './production-plan.service';
import { SubmitProductionPlanRequestDto } from './dto/submit-production-plan.request.dto';

const scene = (id: string, targetDurationSeconds: number) => ({ id, targetDurationSeconds });

describe('ProductionPlanService.submit', () => {
  const tx = { productionPlan: { update: jest.fn() }, scene: { update: jest.fn() } };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ProductionPlanService(prisma as unknown as PrismaService, {} as ProductionProjectService);

  const givenPlan = (overrides: object = {}) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      status: ProductionPlanStatus.DRAFT,
      targetDurationSeconds: 600,
      productionProject: { defaultEpisodeDurationSeconds: 1800 },
      scenes: [scene('s1', 300), scene('s2', 300)],
      ...overrides,
    });

  const dto = (overrides: Partial<SubmitProductionPlanRequestDto> = {}): SubmitProductionPlanRequestDto => ({
    scriptText: 'Kịch bản',
    productionApproach: 'Cinematic',
    targetDurationSeconds: 600,
    estimatedAiResourceUsage: 200,
    scenes: [
      { sceneId: 's1', scriptText: 'Cảnh 1' },
      { sceneId: 's2', scriptText: 'Cảnh 2' },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx.productionPlan.update.mockResolvedValue({ id: 'plan-id' });
  });

  it('submits the plan and every one of its scenes', async () => {
    givenPlan();
    await service.submit('plan-id', dto());

    expect(tx.productionPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-id' },
      data: expect.objectContaining({ status: ProductionPlanStatus.SUBMITTED, totalSceneCount: 2 }) as object,
    });
    expect(tx.scene.update).toHaveBeenCalledTimes(2);
    expect(tx.scene.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { scriptText: 'Cảnh 1', status: SceneStatus.SUBMITTED },
    });
  });

  it('checks the scenes against the duration being submitted, not the previous one', async () => {
    givenPlan({ targetDurationSeconds: 300 });
    await expect(service.submit('plan-id', dto({ targetDurationSeconds: 600 }))).resolves.toBeDefined();

    givenPlan();
    await expect(service.submit('plan-id', dto({ targetDurationSeconds: 500 }))).rejects.toThrow(
      'exceeds the plan target',
    );
  });

  it('refuses scenes longer than the episode limit of the project', async () => {
    givenPlan({ productionProject: { defaultEpisodeDurationSeconds: 500 } });
    await expect(service.submit('plan-id', dto({ targetDurationSeconds: 900 }))).rejects.toThrow(
      'episode duration limit',
    );
  });

  it.each([
    ['a scene is left out', [{ sceneId: 's1', scriptText: 'x' }]],
    [
      'a scene is not in the plan',
      [
        { sceneId: 's1', scriptText: 'x' },
        { sceneId: 'other', scriptText: 'x' },
      ],
    ],
  ])('refuses when %s', async (_case, scenes) => {
    givenPlan();
    await expect(service.submit('plan-id', dto({ scenes }))).rejects.toThrow(BadRequestException);
    expect(tx.productionPlan.update).not.toHaveBeenCalled();
  });

  it('only submits a draft or a plan sent back for changes', async () => {
    givenPlan({ status: ProductionPlanStatus.APPROVED });
    await expect(service.submit('plan-id', dto())).rejects.toThrow(ConflictException);

    givenPlan({ status: ProductionPlanStatus.CHANGES_REQUESTED });
    await expect(service.submit('plan-id', dto())).resolves.toBeDefined();
  });

  it('refuses a plan without scenes', async () => {
    givenPlan({ scenes: [] });
    await expect(service.submit('plan-id', dto({ scenes: [] }))).rejects.toThrow('at least one scene');
  });
});
