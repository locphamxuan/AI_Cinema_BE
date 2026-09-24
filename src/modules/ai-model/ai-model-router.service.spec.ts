import { ServiceUnavailableException } from '@nestjs/common';
import { GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AI_MODEL_CATALOG, JOB_TYPE_ROUTING } from './ai-model-catalog';
import { AiModelRouterService } from './ai-model-router.service';

describe('AiModelRouterService', () => {
  const prisma = { aiModel: { findFirst: jest.fn() } };
  const router = new AiModelRouterService(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('routes every job type to a catalog model', () => {
    for (const jobType of Object.values(GenerationJobType)) {
      expect(AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]]).toBeDefined();
    }
  });

  it('only routes visual job types to the open-weight LoRA base model', () => {
    const openWeightJobTypes = Object.values(GenerationJobType).filter(
      (jobType) => AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]].isOpenWeight,
    );
    expect(openWeightJobTypes.sort()).toEqual([GenerationJobType.POSTER, GenerationJobType.THUMBNAIL]);
  });

  it('looks up the registered model of an active provider', async () => {
    const flux = { id: 'flux-id', name: 'flux-dev' };
    prisma.aiModel.findFirst.mockResolvedValue(flux);

    await expect(router.resolveForJobType(GenerationJobType.POSTER)).resolves.toBe(flux);
    expect(prisma.aiModel.findFirst).toHaveBeenCalledWith({
      where: { name: 'flux-dev', version: '1.0', provider: { name: 'fal.ai', isActive: true } },
    });
  });

  it('fails clearly when the catalog was not seeded', async () => {
    prisma.aiModel.findFirst.mockResolvedValue(null);

    await expect(router.resolveForJobType(GenerationJobType.VOICE)).rejects.toThrow(ServiceUnavailableException);
  });
});
