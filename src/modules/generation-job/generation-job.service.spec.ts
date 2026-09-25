import { ConflictException } from '@nestjs/common';
import {
  AiUsageEntryType,
  GenerationJobStatus,
  GenerationJobType,
  QuotaAllocationStatus,
  SceneStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiModelRouterService } from 'src/modules/ai-model/ai-model-router.service';
import { GenreStyleModelService } from 'src/modules/genre-style-model/genre-style-model.service';
import { GenerationJobService } from './generation-job.service';
import { TemplatePromptComposer } from './prompt-composer';
import type { AiGenerationProvider } from './ai-generation-provider';

const PLAN = {
  id: 'plan-id',
  productionProjectId: 'project-id',
  scriptText: 'Kịch bản tổng',
  productionProject: { status: 'ACTIVE', title: 'Hẻm', description: 'Phim noir', primaryGenre: { name: 'Noir' } },
};
const SCENE = { id: 'scene-id', title: 'Hẻm mưa', description: 'Đêm mưa neon', status: SceneStatus.APPROVED };
const ALLOCATION = { id: 'alloc-id', remainingAmount: 100, status: QuotaAllocationStatus.ACTIVE };

describe('GenerationJobService', () => {
  const tx = {
    generatedAsset: { create: jest.fn() },
    aiUsageLedger: { createMany: jest.fn() },
    quotaAllocation: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    generationJob: { update: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    scene: { findFirst: jest.fn(), update: jest.fn() },
    submission: { findFirst: jest.fn() },
    quotaAllocation: { findFirst: jest.fn(), findMany: jest.fn() },
    generationJob: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const aiModelRouter = { resolveForJob: jest.fn() };
  const genreStyleModelService = { resolveActiveStyleForProject: jest.fn() };
  const aiProvider: AiGenerationProvider = { name: 'test', generate: jest.fn() };
  const service = new GenerationJobService(
    prisma as unknown as PrismaService,
    aiModelRouter as unknown as AiModelRouterService,
    genreStyleModelService as unknown as GenreStyleModelService,
    new TemplatePromptComposer(),
    aiProvider,
  );

  /** Active allocations of the plan, oldest first; findFirst honours the remainingAmount filter. */
  const givenAllocations = (allocations: (typeof ALLOCATION)[]) => {
    prisma.quotaAllocation.findMany.mockResolvedValue(allocations);
    prisma.quotaAllocation.findFirst.mockImplementation(({ where }: { where: { remainingAmount?: { gte: number } } }) =>
      Promise.resolve(allocations.find((a) => a.remainingAmount >= (where.remainingAmount?.gte ?? 0)) ?? null),
    );
  };

  const createdJobData = () =>
    (prisma.generationJob.create.mock.calls as [{ data: Record<string, unknown> }][])[0][0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.productionPlan.findUnique.mockResolvedValue(PLAN);
    prisma.scene.findFirst.mockResolvedValue(SCENE);
    givenAllocations([ALLOCATION]);
    genreStyleModelService.resolveActiveStyleForProject.mockResolvedValue(null);
  });

  describe('create', () => {
    it('routes the model, composes the prompt and queues the job against the active quota', async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'tts-id' }, estimatedTokenCost: 35 });

      await service.create(
        'plan-id',
        { jobType: GenerationJobType.VOICE, sceneId: 'scene-id', prompt: 'giọng trầm' },
        'creator-id',
      );

      expect(createdJobData()).toMatchObject({
        aiModelId: 'tts-id',
        rawPrompt: 'giọng trầm',
        estimatedTokenCost: 35,
        quotaAllocationId: 'alloc-id',
        status: GenerationJobStatus.QUEUED,
      });
      const prompt = (createdJobData().prompt as { create: { composedPrompt: string; seed: number | null } }).create;
      // The voice model reads the spoken line only — never the scene labels or the whole script.
      expect(prompt.composedPrompt).toBe('giọng trầm');
      expect(prompt.seed).toBeNull();
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: 'scene-id' },
        data: { status: SceneStatus.GENERATING },
      });
    });

    it("applies the project's genre LoRA and a fresh seed to visual jobs", async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'flux-id' }, estimatedTokenCost: 30 });
      genreStyleModelService.resolveActiveStyleForProject.mockResolvedValue({
        id: 'style-id',
        triggerKeyword: 'aicinema-horror-style',
        storageKey: 'loras/horror-v1.safetensors',
      });

      await service.create('plan-id', { jobType: GenerationJobType.SCENE_IMAGE, prompt: 'u ám' }, 'creator-id');

      expect(genreStyleModelService.resolveActiveStyleForProject).toHaveBeenCalledWith('project-id', 'flux-id');
      expect(createdJobData()).toMatchObject({
        genreStyleModelId: 'style-id',
        configSnapshot: { loraTriggerKeyword: 'aicinema-horror-style', loraWeights: 'loras/horror-v1.safetensors' },
      });
      const prompt = (createdJobData().prompt as { create: { composedPrompt: string; seed: number | null } }).create;
      expect(prompt.composedPrompt.startsWith('aicinema-horror-style')).toBe(true);
      expect(typeof prompt.seed).toBe('number');
    });

    it('requires and stores the output language of a subtitle job', async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'llm-id' }, estimatedTokenCost: 5 });

      await expect(
        service.create('plan-id', { jobType: GenerationJobType.SUBTITLE, prompt: 'lời thoại' }, 'creator-id'),
      ).rejects.toThrow('language is required for a SUBTITLE job');

      await service.create(
        'plan-id',
        { jobType: GenerationJobType.TRANSLATION, prompt: 'lời thoại', language: 'en' },
        'creator-id',
      );
      expect(createdJobData()).toMatchObject({ jobType: GenerationJobType.TRANSLATION, language: 'en' });
    });

    it('refuses to queue a job whose estimate does not fit the remaining quota (BR-15)', async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'veo-id' }, estimatedTokenCost: 99 });

      await expect(
        service.create('plan-id', { jobType: GenerationJobType.SCENE_VIDEO, prompt: 'rượt đuổi' }, 'creator-id'),
      ).rejects.toThrow(/quota_exceeded/);
      expect(prisma.generationJob.create).not.toHaveBeenCalled();
    });

    it('charges a top-up when the initial allocation can no longer cover the estimate', async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'veo-id' }, estimatedTokenCost: 99 });
      givenAllocations([
        { ...ALLOCATION, remainingAmount: 20 },
        { ...ALLOCATION, id: 'top-up-id', remainingAmount: 500 },
      ]);

      await service.create('plan-id', { jobType: GenerationJobType.SCENE_VIDEO, prompt: 'rượt đuổi' }, 'creator-id');

      expect(createdJobData()).toMatchObject({ quotaAllocationId: 'top-up-id' });
    });

    it('queues nothing for a cancelled project', async () => {
      prisma.productionPlan.findUnique.mockResolvedValue({ ...PLAN, productionProject: { status: 'CANCELLED' } });

      await expect(
        service.create('plan-id', { jobType: GenerationJobType.SCENE_VIDEO, prompt: 'x' }, 'creator-id'),
      ).rejects.toThrow('CANCELLED');
      expect(prisma.generationJob.create).not.toHaveBeenCalled();
    });

    it('requires a quota allocation and a prompt', async () => {
      aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'tts-id' }, estimatedTokenCost: 35 });
      givenAllocations([]);

      await expect(
        service.create('plan-id', { jobType: GenerationJobType.VOICE, prompt: 'x' }, 'creator-id'),
      ).rejects.toThrow(ConflictException);
      await expect(service.create('plan-id', { jobType: GenerationJobType.VOICE }, 'creator-id')).rejects.toThrow(
        'prompt is required',
      );
    });
  });

  describe('run', () => {
    const queuedJob = {
      id: 'job-id',
      productionPlanId: 'plan-id',
      jobType: GenerationJobType.SCENE_VIDEO,
      status: GenerationJobStatus.QUEUED,
      customFunction: null,
      rawPrompt: 'rượt đuổi',
      genreStyleModelId: null,
      configSnapshot: null,
      quotaAllocationId: 'alloc-id',
      prompt: { composedPrompt: 'Direction: rượt đuổi', composeTokenCost: 2, seed: 7 },
    };

    beforeEach(() => {
      prisma.generationJob.findUnique.mockResolvedValue(queuedJob);
      tx.quotaAllocation.findUnique.mockResolvedValue(ALLOCATION);
      tx.generationJob.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...queuedJob, ...data }),
      );
    });

    it('stores the output, books generation and composer cost in the ledger and charges the quota', async () => {
      (aiProvider.generate as jest.Mock).mockResolvedValue({ outputUnits: 18, storageKey: 'video.m3u8' });
      tx.quotaAllocation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      const job = await service.run('job-id');

      expect(tx.aiUsageLedger.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            entryType: AiUsageEntryType.GENERATION,
            tokenCost: 108,
            outputDurationSeconds: 18,
          }),
          expect.objectContaining({ entryType: AiUsageEntryType.PROMPT_COMPOSE, tokenCost: 2 }),
        ],
      });
      expect(tx.quotaAllocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'alloc-id', remainingAmount: { gte: 110 } },
        data: { remainingAmount: { decrement: 110 } },
      });
      expect(job).toMatchObject({ status: GenerationJobStatus.COMPLETED, resourceCost: 110 });
    });

    it('keeps an overrun visible: full cost in the ledger, allocation closed at zero', async () => {
      (aiProvider.generate as jest.Mock).mockResolvedValue({ outputUnits: 40 });
      tx.quotaAllocation.updateMany.mockResolvedValue({ count: 0 });

      const job = await service.run('job-id');

      expect(tx.quotaAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-id' },
        data: { remainingAmount: 0, status: QuotaAllocationStatus.CONSUMED },
      });
      expect(job).toMatchObject({ resourceCost: 242 });
    });

    it('marks the job FAILED when the provider errors, without charging anything', async () => {
      (aiProvider.generate as jest.Mock).mockRejectedValue(new Error('provider down'));
      prisma.generationJob.update.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));

      const job = await service.run('job-id');

      expect(job).toMatchObject({ status: GenerationJobStatus.FAILED, errorMessage: 'provider down' });
      expect(tx.aiUsageLedger.createMany).not.toHaveBeenCalled();
    });
  });

  it('retries by creating a new attempt with the revised prompt', async () => {
    prisma.generationJob.findUnique.mockResolvedValue({
      id: 'job-id',
      productionPlanId: 'plan-id',
      jobType: GenerationJobType.VOICE,
      status: GenerationJobStatus.COMPLETED,
      attemptNumber: 2,
      rawPrompt: 'cũ',
      customFunction: null,
      sceneId: null,
      configSnapshot: null,
      createdById: 'creator-id',
    });
    aiModelRouter.resolveForJob.mockResolvedValue({ model: { id: 'tts-id' }, estimatedTokenCost: 35 });

    await service.retry('job-id', { prompt: 'mới' });

    expect(createdJobData()).toMatchObject({ parentJobId: 'job-id', attemptNumber: 3, rawPrompt: 'mới' });
  });

  describe('discard', () => {
    const givenJob = (status: GenerationJobStatus) =>
      prisma.generationJob.findUnique.mockResolvedValue({
        id: 'job-id',
        productionPlanId: 'plan-id',
        sceneId: 'scene-id',
        status,
      });

    it('cancels a completed job so it drops out of its scene, also after the cut was sent back', async () => {
      givenJob(GenerationJobStatus.COMPLETED);
      prisma.submission.findFirst.mockResolvedValue({ status: 'CHANGES_REQUESTED' });

      await service.discard('job-id');

      expect(prisma.generationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'job-id' }, data: { status: GenerationJobStatus.CANCELLED } }),
      );
    });

    it('refuses a job that is still running', async () => {
      givenJob(GenerationJobStatus.RUNNING);

      await expect(service.discard('job-id')).rejects.toThrow('cannot be removed');
      expect(prisma.generationJob.update).not.toHaveBeenCalled();
    });

    it('refuses while the episode cut is with the Reviewer', async () => {
      givenJob(GenerationJobStatus.COMPLETED);
      prisma.submission.findFirst.mockResolvedValue({ status: 'SUBMITTED' });

      await expect(service.discard('job-id')).rejects.toThrow('can no longer be changed');
      expect(prisma.generationJob.update).not.toHaveBeenCalled();
    });
  });
});
