import { BadRequestException } from '@nestjs/common';
import { AssetType, GeneratedAssetStatus, ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SceneService } from './scene.service';

type Job = {
  id: string;
  parentJobId: string | null;
  status: string;
  generatedAssets: { assetType: AssetType; status: GeneratedAssetStatus }[];
};

const video: Job['generatedAssets'] = [{ assetType: AssetType.VIDEO, status: GeneratedAssetStatus.GENERATED }];
const job = (id: string, status: string, parentJobId: string | null = null, generatedAssets = video): Job => ({
  id,
  parentJobId,
  status,
  generatedAssets,
});

describe('SceneService.submit', () => {
  const tx = {
    submission: { create: jest.fn() },
    scene: { update: jest.fn() },
    productionPlan: { update: jest.fn() },
  };
  const prisma = {
    scene: { findUnique: jest.fn() },
    productionPlan: { findUnique: jest.fn() },
    generationJob: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new SceneService(prisma as unknown as PrismaService);

  const submitWith = (jobs: Job[]) => {
    prisma.generationJob.findMany.mockResolvedValue(jobs);
    return service.submit('scene-id', {}, 'creator-id');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scene.findUnique.mockResolvedValue({
      id: 'scene-id',
      productionPlanId: 'plan-id',
      status: SceneStatus.GENERATING,
      productionPlan: { productionProjectId: 'project-id' },
    });
    prisma.productionPlan.findUnique.mockResolvedValue({ id: 'plan-id', status: ProductionPlanStatus.APPROVED });
    tx.submission.create.mockResolvedValue({ id: 'submission-id' });
  });

  it('completes a scene whose failed job was retried successfully', async () => {
    await submitWith([job('first', 'FAILED', null, []), job('retry', 'COMPLETED', 'first')]);

    expect(tx.scene.update).toHaveBeenCalledWith({
      where: { id: 'scene-id' },
      data: { status: SceneStatus.COMPLETED },
    });
  });

  it('rejects a scene whose latest attempt failed', async () => {
    await expect(
      submitWith([job('clip', 'COMPLETED'), job('first', 'COMPLETED'), job('retry', 'FAILED', 'first', [])]),
    ).rejects.toThrow(BadRequestException);
    expect(tx.scene.update).not.toHaveBeenCalled();
  });

  it('ignores the video of a superseded attempt', async () => {
    await expect(
      submitWith([
        job('first', 'COMPLETED'),
        job('retry', 'COMPLETED', 'first', [{ assetType: AssetType.IMAGE, status: GeneratedAssetStatus.GENERATED }]),
      ]),
    ).rejects.toThrow('Scene must have at least one VIDEO asset to be submitted');
  });
});
