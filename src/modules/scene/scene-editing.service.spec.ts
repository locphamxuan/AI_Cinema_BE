import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SceneService } from './scene.service';

/** Scenes are only edited while their plan is a draft or was sent back (BR-39). */
describe('SceneService editing', () => {
  const tx = {
    scene: { create: jest.fn(), delete: jest.fn() },
    productionPlan: { update: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    productionProject: { findUnique: jest.fn() },
    scene: { findUnique: jest.fn(), update: jest.fn() },
    generationJob: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new SceneService(prisma as unknown as PrismaService);
  const newScene = { sceneNumber: 3, title: 'Cảnh 3', targetDurationSeconds: 200 };

  const givenPlan = (overrides: object = {}) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      productionProjectId: 'project-id',
      status: ProductionPlanStatus.DRAFT,
      targetDurationSeconds: 600,
      totalSceneCount: 2,
      scenes: [{ targetDurationSeconds: 200 }, { targetDurationSeconds: 150 }],
      ...overrides,
    });
  const givenScene = () =>
    prisma.scene.findUnique.mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(
        where.id ? { id: 's1', productionPlanId: 'plan-id', sceneNumber: 1, targetDurationSeconds: 200 } : null,
      ),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    givenPlan();
    prisma.productionProject.findUnique.mockResolvedValue({ defaultEpisodeDurationSeconds: 900 });
    prisma.scene.findUnique.mockResolvedValue(null);
  });

  it('adds a scene that fits the episode and counts it', async () => {
    await service.create('plan-id', newScene);
    expect(tx.scene.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productionPlanId: 'plan-id', sceneNumber: 3 }) as object,
    });
    expect(tx.productionPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-id' },
      data: { totalSceneCount: { increment: 1 } },
    });
  });

  it('refuses a scene that overruns the plan or the episode limit', async () => {
    await expect(service.create('plan-id', { ...newScene, targetDurationSeconds: 300 })).rejects.toThrow('plan target');

    givenPlan({ targetDurationSeconds: null });
    prisma.productionProject.findUnique.mockResolvedValue({ defaultEpisodeDurationSeconds: 400 });
    await expect(service.create('plan-id', newScene)).rejects.toThrow('episode duration limit');
  });

  it('refuses a duplicate scene number', async () => {
    prisma.scene.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('plan-id', newScene)).rejects.toThrow(ConflictException);
  });

  it('locks the scenes of a plan under review or approved', async () => {
    givenPlan({ status: ProductionPlanStatus.UNDER_REVIEW });
    await expect(service.create('plan-id', newScene)).rejects.toThrow('DRAFT or CHANGES_REQUESTED');
  });

  it('re-checks the duration when a scene gets longer', async () => {
    givenScene();
    await expect(service.update('s1', { targetDurationSeconds: 500 })).rejects.toThrow(BadRequestException);

    await service.update('s1', { targetDurationSeconds: 400, title: 'Mở đầu' });
    expect(prisma.scene.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { targetDurationSeconds: 400, title: 'Mở đầu' },
    });
  });

  it('removes a scene without generation jobs and uncounts it', async () => {
    givenScene();
    prisma.generationJob.findFirst.mockResolvedValueOnce({ id: 'job' });
    await expect(service.remove('s1')).rejects.toThrow('generation jobs');

    await service.remove('s1');
    expect(tx.scene.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(tx.productionPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-id' },
      data: { totalSceneCount: { decrement: 1 } },
    });
  });
});
