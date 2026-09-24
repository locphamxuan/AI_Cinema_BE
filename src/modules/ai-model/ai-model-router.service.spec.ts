import { ServiceUnavailableException } from '@nestjs/common';
import { GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AI_MODEL_CATALOG, JOB_TYPE_ROUTING, resolveCatalogKey } from './ai-model-catalog';
import { AiModelRouterService } from './ai-model-router.service';

describe('AI model catalog', () => {
  it('routes every job type to a catalog model', () => {
    for (const jobType of Object.values(GenerationJobType)) {
      expect(AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]]).toBeDefined();
    }
  });

  it('only routes image jobs to the open-weight LoRA base model', () => {
    const openWeightJobTypes = Object.values(GenerationJobType).filter(
      (jobType) => AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]].isOpenWeight,
    );
    expect(openWeightJobTypes.sort()).toEqual(
      [GenerationJobType.POSTER, GenerationJobType.SCENE_IMAGE, GenerationJobType.THUMBNAIL].sort(),
    );
  });

  it('sends a described CUSTOM function to the matching specialist, otherwise to the general LLM', () => {
    expect(resolveCatalogKey(GenerationJobType.CUSTOM, 'Đồng bộ khẩu hình nhân vật')).toEqual({
      key: 'video',
      match: 'specialist',
    });
    expect(resolveCatalogKey(GenerationJobType.CUSTOM, 'Lồng tiếng giọng trầm')).toEqual({
      key: 'tts',
      match: 'specialist',
    });
    expect(resolveCatalogKey(GenerationJobType.CUSTOM, 'viết lại lời thoại cảnh này cho nhanh hơn')).toEqual({
      key: 'llm',
      match: 'general',
    });
  });
});

describe('AiModelRouterService', () => {
  const prisma = { aiModel: { findFirst: jest.fn() } };
  const router = new AiModelRouterService(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('looks up the registered model of an active provider with its estimate', async () => {
    const flux = { id: 'flux-id', name: 'flux-dev' };
    prisma.aiModel.findFirst.mockResolvedValue(flux);

    const resolved = await router.resolveForJob(GenerationJobType.SCENE_IMAGE);

    expect(resolved).toMatchObject({ model: flux, match: 'catalog', estimatedTokenCost: 30 });
    expect(prisma.aiModel.findFirst).toHaveBeenCalledWith({
      where: { name: 'flux-dev', version: '1.0', provider: { name: 'fal.ai', isActive: true } },
    });
  });

  it('fails clearly when the catalog was not seeded', async () => {
    prisma.aiModel.findFirst.mockResolvedValue(null);

    await expect(router.resolveForJob(GenerationJobType.VOICE)).rejects.toThrow(ServiceUnavailableException);
  });

  it('exposes one routing row per job type', () => {
    const table = router.routingTable();
    expect(table).toHaveLength(Object.values(GenerationJobType).length);
    expect(table.find((row) => row.jobType === GenerationJobType.SCENE_VIDEO)).toMatchObject({
      model: 'veo-3',
      estimatedTokenCost: 60,
    });
  });
});
