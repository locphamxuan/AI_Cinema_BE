import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType, Prisma, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiModelRouterService } from 'src/modules/ai-model/ai-model-router.service';
import { AI_MODEL_CATALOG, resolveCatalogKey } from 'src/modules/ai-model/ai-model-catalog';
import { GenreStyleModelService } from 'src/modules/genre-style-model/genre-style-model.service';
import { assertProjectOpen } from 'src/modules/production-project/project-lifecycle';
import { assertCutOpen } from 'src/modules/scene/cut-lock';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';
import { RetryGenerationJobRequestDto } from './dto/retry-generation-job.request.dto';
import {
  CANCELLABLE,
  DISCARDABLE,
  JOB_DETAIL_INCLUDE,
  JOB_INCLUDE,
  JOB_LIST_INCLUDE,
  LANGUAGE_JOB_TYPES,
  RUNNABLE,
  VISUAL_JOB_TYPES,
  assertAttemptInput,
  type NewAttempt,
} from './generation-job.rules';
import { reserveAllocation, settleJob } from './generation-billing';
import { composeInput, loraWeightsOf, requirePlan } from './generation-context';
import { PROMPT_COMPOSER, type PromptComposer } from './prompt-composer';
import {
  AI_GENERATION_PROVIDER,
  assetTypeFor,
  tokenCostOf,
  type AiGenerationProvider,
  type AiGenerationResult,
} from './ai-generation-provider';

@Injectable()
export class GenerationJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModelRouter: AiModelRouterService,
    private readonly genreStyleModelService: GenreStyleModelService,
    @Inject(PROMPT_COMPOSER) private readonly promptComposer: PromptComposer,
    @Inject(AI_GENERATION_PROVIDER) private readonly aiProvider: AiGenerationProvider,
  ) {}

  async create(planId: string, dto: CreateGenerationJobRequestDto, createdById: string) {
    await requirePlan(this.prisma, planId);

    let attemptNumber = 1;
    if (dto.parentJobId) {
      const parent = await this.prisma.generationJob.findFirst({
        where: { id: dto.parentJobId, productionPlanId: planId },
      });
      if (!parent) throw new BadRequestException(`Parent job "${dto.parentJobId}" does not belong to plan "${planId}"`);
      attemptNumber = parent.attemptNumber + 1;
    }

    return this.createAttempt({
      planId,
      jobType: dto.jobType,
      rawPrompt: dto.prompt ?? null,
      customFunction: dto.customFunction ?? null,
      language: dto.language ?? null,
      sceneId: dto.sceneId ?? null,
      parentJobId: dto.parentJobId ?? null,
      attemptNumber,
      configSnapshot: dto.configSnapshot as Prisma.InputJsonValue | undefined,
      createdById,
    });
  }

  async findAll(planId: string) {
    await requirePlan(this.prisma, planId);
    return this.prisma.generationJob.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: JOB_LIST_INCLUDE,
    });
  }

  async findById(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: JOB_DETAIL_INCLUDE,
    });
    if (!job) throw new NotFoundException(`Generation job with id "${jobId}" does not exist`);
    return job;
  }

  /**
   * §4.1.7.2: the Creator re-prompts the same function of the same scene. A new
   * attempt row is created (the old one stays for audit) and it is charged again —
   * retrying is never free (BR-41).
   */
  async retry(jobId: string, dto: RetryGenerationJobRequestDto = {}) {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Generation job with id "${jobId}" does not exist`);
    if (job.status !== GenerationJobStatus.FAILED && job.status !== GenerationJobStatus.COMPLETED) {
      throw new ConflictException('Only a FAILED or COMPLETED job can be retried');
    }

    return this.createAttempt({
      planId: job.productionPlanId,
      jobType: job.jobType,
      rawPrompt: dto.prompt ?? job.rawPrompt,
      customFunction: job.customFunction,
      language: job.language,
      sceneId: job.sceneId,
      parentJobId: job.id,
      attemptNumber: job.attemptNumber + 1,
      configSnapshot: job.configSnapshot === null ? undefined : job.configSnapshot,
      createdById: job.createdById,
    });
  }

  async cancel(jobId: string) {
    const job = await this.findById(jobId);
    if (!CANCELLABLE.includes(job.status)) {
      throw new ConflictException(
        `Only ${CANCELLABLE.join('/')} jobs can be cancelled, current status "${job.status}"`,
      );
    }
    return this.prisma.generationJob.update({ where: { id: jobId }, data: { status: GenerationJobStatus.CANCELLED } });
  }

  /**
   * The Creator removes a generation step from a scene. The job is marked CANCELLED
   * (kept for audit, tokens already spent are not refunded) so it no longer counts
   * as the latest attempt of its chain.
   */
  async discard(jobId: string) {
    const job = await this.findById(jobId);
    if (!DISCARDABLE.includes(job.status)) {
      throw new ConflictException(`A ${job.status} job cannot be removed`);
    }
    const plan = await requirePlan(this.prisma, job.productionPlanId);
    assertProjectOpen(plan.productionProject);
    await assertCutOpen(this.prisma, plan.id);
    return this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: GenerationJobStatus.CANCELLED },
      include: JOB_INCLUDE,
    });
  }

  /** Runs a queued job through the AI provider, stores its output and charges the quota. */
  async run(jobId: string) {
    const job = await this.findById(jobId);
    if (!RUNNABLE.includes(job.status)) {
      throw new ConflictException(`Only ${RUNNABLE.join('/')} jobs can be run, current status "${job.status}"`);
    }
    if (job.jobType === GenerationJobType.VIDEO_ASSEMBLY) {
      throw new ConflictException('A VIDEO_ASSEMBLY job is finalized through the episode-package assemble endpoint');
    }

    await this.prisma.generationJob.update({ where: { id: jobId }, data: { status: GenerationJobStatus.RUNNING } });

    const { key } = resolveCatalogKey(job.jobType, job.customFunction);
    const model = AI_MODEL_CATALOG[key];
    let result: AiGenerationResult;
    try {
      result = await this.aiProvider.generate({
        model,
        composedPrompt: job.prompt?.composedPrompt ?? job.rawPrompt ?? '',
        seed: job.prompt?.seed,
        loraWeights: job.genreStyleModelId ? loraWeightsOf(job.configSnapshot) : null,
        language: job.language,
      });
    } catch (error) {
      return this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'AI provider error',
        },
        include: JOB_INCLUDE,
      });
    }

    const tokenCost = tokenCostOf(model, result.outputUnits);
    return this.prisma.$transaction(async (tx) => {
      await tx.generatedAsset.create({
        data: {
          generationJobId: jobId,
          assetType: assetTypeFor(job.jobType, model.modality),
          language: job.language,
          contentText: result.contentText,
          storageKey: result.storageKey,
          mimeType: result.mimeType,
          durationSeconds: result.durationSeconds,
        },
      });
      return settleJob(tx, job, tokenCost, result.outputUnits);
    });
  }

  async createGeneratedAsset(jobId: string, dto: CreateGeneratedAssetRequestDto) {
    await this.findById(jobId);

    return this.prisma.generatedAsset.create({
      data: {
        generationJobId: jobId,
        assetType: dto.assetType,
        language: dto.language,
        contentText: dto.contentText,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        checksumSha256: dto.checksumSha256,
        durationSeconds: dto.durationSeconds,
        resolution: dto.resolution,
        metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  /** Records the result reported by an external provider callback. */
  async complete(jobId: string, dto: CompleteGenerationJobRequestDto) {
    const job = await this.findById(jobId);
    if (job.status !== GenerationJobStatus.RUNNING && job.status !== GenerationJobStatus.QUEUED) {
      throw new ConflictException(`Only RUNNING/QUEUED jobs can be completed, current status "${job.status}"`);
    }
    if (job.jobType === GenerationJobType.VIDEO_ASSEMBLY) {
      throw new ConflictException(
        'A VIDEO_ASSEMBLY job is finalized through the episode-package assemble endpoint, not complete()',
      );
    }

    return this.prisma.$transaction((tx) =>
      settleJob(tx, job, dto.resourceCost ?? 0, dto.outputDurationSeconds ?? null),
    );
  }

  private async createAttempt(attempt: NewAttempt) {
    const { planId, jobType, rawPrompt, customFunction, language, sceneId } = attempt;
    assertAttemptInput(attempt);

    const plan = await requirePlan(this.prisma, planId);
    assertProjectOpen(plan.productionProject);
    const scene = sceneId
      ? await this.prisma.scene.findFirst({ where: { id: sceneId, productionPlanId: planId } })
      : null;
    if (sceneId && !scene) throw new BadRequestException(`Scene "${sceneId}" does not belong to plan "${planId}"`);

    const { model, estimatedTokenCost } = await this.aiModelRouter.resolveForJob(jobType, customFunction);
    const genreStyle = VISUAL_JOB_TYPES.includes(jobType)
      ? await this.genreStyleModelService.resolveActiveStyleForProject(plan.productionProjectId, model.id)
      : null;

    const composed = await this.promptComposer.compose(
      await composeInput(this.prisma, { plan, scene, attempt, loraTriggerKeyword: genreStyle?.triggerKeyword }),
    );

    const required = estimatedTokenCost + composed.composeTokenCost;
    const allocation = await reserveAllocation(this.prisma, planId, required);

    const configSnapshot = genreStyle
      ? {
          ...(attempt.configSnapshot as Record<string, unknown> | undefined),
          loraTriggerKeyword: genreStyle.triggerKeyword,
          loraWeights: genreStyle.storageKey,
        }
      : attempt.configSnapshot;

    // First generation for an approved scene starts its production (scene submit needs GENERATING).
    if (scene?.status === SceneStatus.APPROVED) {
      await this.prisma.scene.update({ where: { id: scene.id }, data: { status: SceneStatus.GENERATING } });
    }

    return this.prisma.generationJob.create({
      data: {
        productionPlanId: planId,
        aiModelId: model.id,
        jobType,
        sceneId,
        parentJobId: attempt.parentJobId,
        attemptNumber: attempt.attemptNumber,
        rawPrompt,
        customFunction,
        language: LANGUAGE_JOB_TYPES.includes(jobType) ? language : null,
        estimatedTokenCost,
        configSnapshot: configSnapshot,
        genreStyleModelId: genreStyle?.id,
        quotaAllocationId: allocation.id,
        status: GenerationJobStatus.QUEUED,
        queuedAt: new Date(),
        createdById: attempt.createdById,
        prompt: {
          create: {
            composedPrompt: composed.composedPrompt,
            composeModel: composed.composeModel,
            composeTokenCost: composed.composeTokenCost,
            seed: VISUAL_JOB_TYPES.includes(jobType) ? Math.floor(Math.random() * 2 ** 31) : null,
          },
        },
      },
      include: JOB_INCLUDE,
    });
  }
}
