import { GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiModelRouterService } from 'src/modules/ai-model/ai-model-router.service';
import { GenreStyleModelService } from 'src/modules/genre-style-model/genre-style-model.service';
import { GenerationJobService } from './generation-job.service';

describe('GenerationJobService.create', () => {
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    generationJob: { create: jest.fn() },
  };
  const aiModelRouter = { resolveForJobType: jest.fn() };
  const genreStyleModelService = { resolveActiveStyleForProject: jest.fn() };
  const service = new GenerationJobService(
    prisma as unknown as PrismaService,
    aiModelRouter as unknown as AiModelRouterService,
    genreStyleModelService as unknown as GenreStyleModelService,
  );

  const createdJobData = () => (prisma.generationJob.create.mock.calls as [{ data: unknown }][])[0][0].data;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.productionPlan.findUnique.mockResolvedValue({ id: 'plan-id', productionProjectId: 'project-id' });
  });

  it('uses the system-routed model instead of a Creator-chosen one', async () => {
    aiModelRouter.resolveForJobType.mockResolvedValue({ id: 'gpt-id' });
    genreStyleModelService.resolveActiveStyleForProject.mockResolvedValue(null);

    await service.create('plan-id', { jobType: GenerationJobType.SCRIPT }, 'creator-id');

    expect(aiModelRouter.resolveForJobType).toHaveBeenCalledWith(GenerationJobType.SCRIPT);
    expect(createdJobData()).toMatchObject({
      aiModelId: 'gpt-id',
      genreStyleModelId: undefined,
      configSnapshot: undefined,
    });
  });

  it("applies the project's active genre LoRA to visual jobs", async () => {
    aiModelRouter.resolveForJobType.mockResolvedValue({ id: 'flux-id' });
    genreStyleModelService.resolveActiveStyleForProject.mockResolvedValue({
      id: 'style-id',
      triggerKeyword: 'aicinema-horror-style',
      storageKey: 'loras/aicinema-horror-style-v1.safetensors',
    });

    await service.create(
      'plan-id',
      { jobType: GenerationJobType.POSTER, configSnapshot: { aspectRatio: '2:3' } },
      'creator-id',
    );

    expect(genreStyleModelService.resolveActiveStyleForProject).toHaveBeenCalledWith('project-id', 'flux-id');
    expect(createdJobData()).toMatchObject({
      aiModelId: 'flux-id',
      genreStyleModelId: 'style-id',
      configSnapshot: {
        aspectRatio: '2:3',
        loraTriggerKeyword: 'aicinema-horror-style',
        loraWeights: 'loras/aicinema-horror-style-v1.safetensors',
      },
    });
  });
});
