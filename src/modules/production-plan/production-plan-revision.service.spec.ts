import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from 'src/modules/production-project/production-project.service';
import { ProductionPlanService } from './production-plan.service';

const scene = (sceneNumber: number, targetDurationSeconds: number) => ({
  sceneNumber,
  title: `Cảnh ${sceneNumber}`,
  scriptText: null,
  description: `Mô tả ${sceneNumber}`,
  targetDurationSeconds,
  estimatedTokens: 100,
});

describe('ProductionPlanService editing and revisions', () => {
  const tx = {
    productionPlan: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    scene: { createMany: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn(), update: jest.fn() },
    productionProject: { findUnique: jest.fn() },
    scene: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const projects = { findById: jest.fn() };
  const service = new ProductionPlanService(
    prisma as unknown as PrismaService,
    projects as unknown as ProductionProjectService,
  );

  const givenPlan = (overrides: object = {}) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      productionProjectId: 'project-id',
      episodeNumber: 2,
      seasonNumber: 1,
      seasonEpisodeNumber: 2,
      allottedDurationSeconds: 900,
      status: ProductionPlanStatus.DRAFT,
      targetDurationSeconds: 600,
      scriptText: 'Kịch bản',
      productionApproach: 'Cinematic',
      targetLanguages: ['vi'],
      estimatedAiResourceUsage: 200,
      scenes: [scene(1, 200), scene(2, 300)],
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    givenPlan();
    prisma.productionProject.findUnique.mockResolvedValue({ id: 'project-id', defaultEpisodeDurationSeconds: 900 });
    prisma.scene.findMany.mockResolvedValue([{ targetDurationSeconds: 200 }, { targetDurationSeconds: 300 }]);
    tx.productionPlan.findFirst.mockResolvedValue({ planVersion: 1 });
    tx.productionPlan.create.mockResolvedValue({ id: 'revised-id' });
  });

  describe('update', () => {
    it('edits a draft within the scenes and the episode limit', async () => {
      await service.update('plan-id', { targetDurationSeconds: 700, productionApproach: 'Anime' });
      expect(prisma.productionPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-id' },
        data: { targetDurationSeconds: 700, productionApproach: 'Anime' },
      });

      await expect(service.update('plan-id', { targetDurationSeconds: 400 })).rejects.toThrow('below the current');
      await expect(service.update('plan-id', { targetDurationSeconds: 1000 })).rejects.toThrow('cannot exceed');
    });

    it('edits a draft or a plan sent back for changes, nothing under review or later', async () => {
      givenPlan({ status: ProductionPlanStatus.CHANGES_REQUESTED });
      await expect(service.update('plan-id', { scriptText: 'x' })).resolves.toBeUndefined();

      givenPlan({ status: ProductionPlanStatus.SUBMITTED });
      await expect(service.update('plan-id', { scriptText: 'x' })).rejects.toThrow(ConflictException);
    });
  });

  describe('createRevision', () => {
    it('copies the plan and its scenes into the next version', async () => {
      await service.createRevision('project-id', 'plan-id', { scriptText: 'Bản mới' }, 'creator-id');

      const [{ data }] = tx.productionPlan.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data).toMatchObject({
        episodeNumber: 2,
        planVersion: 2,
        previousPlanId: 'plan-id',
        scriptText: 'Bản mới',
        productionApproach: 'Cinematic',
        totalSceneCount: 2,
        createdById: 'creator-id',
      });
      const [{ data: scenes }] = tx.scene.createMany.mock.calls[0] as [{ data: { productionPlanId: string }[] }];
      expect(scenes.map((s) => s.productionPlanId)).toEqual(['revised-id', 'revised-id']);
    });

    it.each([
      ['a plan of another project', 'other-project', {}, BadRequestException],
      ['an approved plan', 'project-id', { status: ProductionPlanStatus.APPROVED }, ConflictException],
    ])('refuses to revise %s', async (_case, projectId, overrides, error) => {
      givenPlan(overrides);
      await expect(service.createRevision(projectId, 'plan-id', {}, 'creator-id')).rejects.toThrow(error);
      expect(tx.productionPlan.create).not.toHaveBeenCalled();
    });

    it('keeps the revised duration above its scenes and within the episode limit', async () => {
      await expect(
        service.createRevision('project-id', 'plan-id', { targetDurationSeconds: 400 }, 'creator-id'),
      ).rejects.toThrow('lower than the existing scene total');
      await expect(
        service.createRevision('project-id', 'plan-id', { targetDurationSeconds: 1200 }, 'creator-id'),
      ).rejects.toThrow('cannot exceed');
    });
  });
});
