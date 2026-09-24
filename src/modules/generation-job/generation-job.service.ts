import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiUsageEntryType,
  GenerationJobStatus,
  GenerationJobType,
  Prisma,
  QuotaAllocationStatus,
  SceneStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiModelRouterService } from 'src/modules/ai-model/ai-model-router.service';
import { AI_MODEL_CATALOG, resolveCatalogKey } from 'src/modules/ai-model/ai-model-catalog';
import { GenreStyleModelService } from 'src/modules/genre-style-model/genre-style-model.service';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';
import { RetryGenerationJobRequestDto } from './dto/retry-generation-job.request.dto';
import { PROMPT_COMPOSER, type PromptComposer } from './prompt-composer';
import {
  AI_GENERATION_PROVIDER,
  assetTypeFor,
  tokenCostOf,
  type AiGenerationProvider,
  type AiGenerationResult,
} from './ai-generation-provider';

const CANCELLABLE: GenerationJobStatus[] = [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED];
const RUNNABLE: GenerationJobStatus[] = [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED];
const VISUAL_JOB_TYPES: GenerationJobType[] = [
  GenerationJobType.SCENE_IMAGE,
  GenerationJobType.SCENE_VIDEO,
  GenerationJobType.POSTER,
  GenerationJobType.THUMBNAIL,
];

const JOB_INCLUDE = {
  aiModel: true,
  prompt: true,
  scene: { select: { id: true, title: true } },
  generatedAssets: true,
} satisfies Prisma.GenerationJobInclude;

interface NewAttempt {
  planId: string;
  jobType: GenerationJobType;
  rawPrompt: string | null;
  customFunction: string | null;
  sceneId: string | null;
  parentJobId: string | null;
  attemptNumber: number;
  configSnapshot: Prisma.InputJsonValue | undefined;
  createdById: string;
}

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
    await this.requirePlan(planId);

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
      sceneId: dto.sceneId ?? null,
      parentJobId: dto.parentJobId ?? null,
      attemptNumber,
      configSnapshot: dto.configSnapshot as Prisma.InputJsonValue | undefined,
      createdById,
    });
  }

  async findAll(planId: string) {
    await this.requirePlan(planId);
    return this.prisma.generationJob.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: {
        ...JOB_INCLUDE,
        quotaAllocation: { select: { id: true, allocationType: true, remainingAmount: true } },
      },
    });
  }

  async findById(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        ...JOB_INCLUDE,
        createdBy: { select: { fullName: true } },
        quotaAllocation: { select: { id: true, allocationType: true, remainingAmount: true } },
        usageEntries: { orderBy: { recordedAt: 'asc' } },
      },
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
        loraWeights: job.genreStyleModelId ? this.loraWeights(job.configSnapshot) : null,
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
          contentText: result.contentText,
          storageKey: result.storageKey,
          mimeType: result.mimeType,
          durationSeconds: result.durationSeconds,
        },
      });
      return this.settle(tx, job, tokenCost, result.outputUnits);
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
      this.settle(tx, job, dto.resourceCost ?? 0, dto.outputDurationSeconds ?? null),
    );
  }

  private async createAttempt(attempt: NewAttempt) {
    const { planId, jobType, rawPrompt, customFunction, sceneId } = attempt;
    if (jobType !== GenerationJobType.VIDEO_ASSEMBLY && !rawPrompt?.trim()) {
      throw new BadRequestException('prompt is required');
    }
    if (jobType === GenerationJobType.CUSTOM && !customFunction?.trim()) {
      throw new BadRequestException('customFunction is required for a CUSTOM job');
    }

    const plan = await this.requirePlan(planId);
    const scene = sceneId
      ? await this.prisma.scene.findFirst({ where: { id: sceneId, productionPlanId: planId } })
      : null;
    if (sceneId && !scene) throw new BadRequestException(`Scene "${sceneId}" does not belong to plan "${planId}"`);

    const { model, estimatedTokenCost } = await this.aiModelRouter.resolveForJob(jobType, customFunction);
    const genreStyle = VISUAL_JOB_TYPES.includes(jobType)
      ? await this.genreStyleModelService.resolveActiveStyleForProject(plan.productionProjectId, model.id)
      : null;

    const composed = await this.promptComposer.compose({
      rawPrompt: rawPrompt ?? '',
      sceneTitle: scene?.title,
      sceneDescription: scene?.description,
      scriptText: jobType === GenerationJobType.SCRIPT || jobType === GenerationJobType.VOICE ? plan.scriptText : null,
      customFunction,
      loraTriggerKeyword: genreStyle?.triggerKeyword,
    });

    // BR-15: the estimate must fit in the plan's active quota before anything is generated.
    const allocation = await this.activeAllocation(this.prisma, planId);
    const required = estimatedTokenCost + composed.composeTokenCost;
    if (!allocation) throw new ConflictException('The plan has no active AI quota allocation');
    if (Number(allocation.remainingAmount) < required) {
      throw new ConflictException(
        `quota_exceeded: needs ${required} tokens, ${Number(allocation.remainingAmount)} left`,
      );
    }

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

  /**
   * Books the actual cost: one ledger row for the generation and one for the
   * Prompt Composer call, then an atomic decrement of the allocation. A cost the
   * allocation can no longer cover still lands in the ledger (the output exists),
   * and the allocation is closed at zero instead of hiding the overrun.
   */
  private async settle(
    tx: Prisma.TransactionClient,
    job: {
      id: string;
      productionPlanId: string;
      quotaAllocationId: string | null;
      prompt: { composeTokenCost: number } | null;
    },
    tokenCost: number,
    outputUnits: number | null,
  ) {
    const allocation = job.quotaAllocationId
      ? await tx.quotaAllocation.findUnique({ where: { id: job.quotaAllocationId } })
      : await this.activeAllocation(tx, job.productionPlanId);
    const composeCost = job.prompt?.composeTokenCost ?? 0;
    const total = tokenCost + composeCost;

    await tx.aiUsageLedger.createMany({
      data: [
        {
          generationJobId: job.id,
          productionPlanId: job.productionPlanId,
          quotaAllocationId: allocation?.id,
          entryType: AiUsageEntryType.GENERATION,
          outputDurationSeconds: outputUnits,
          tokenCost,
        },
        ...(composeCost > 0
          ? [
              {
                generationJobId: job.id,
                productionPlanId: job.productionPlanId,
                quotaAllocationId: allocation?.id,
                entryType: AiUsageEntryType.PROMPT_COMPOSE,
                tokenCost: composeCost,
              },
            ]
          : []),
      ],
    });

    if (allocation && total > 0) {
      const charged = await tx.quotaAllocation.updateMany({
        where: { id: allocation.id, remainingAmount: { gte: total } },
        data: { remainingAmount: { decrement: total } },
      });
      if (charged.count === 0) {
        await tx.quotaAllocation.update({
          where: { id: allocation.id },
          data: { remainingAmount: 0, status: QuotaAllocationStatus.CONSUMED },
        });
      } else {
        await tx.quotaAllocation.updateMany({
          where: { id: allocation.id, remainingAmount: 0 },
          data: { status: QuotaAllocationStatus.CONSUMED },
        });
      }
    }

    return tx.generationJob.update({
      where: { id: job.id },
      data: {
        status: GenerationJobStatus.COMPLETED,
        completedAt: new Date(),
        resourceCost: total,
        outputDurationSeconds: outputUnits,
        quotaAllocationId: allocation?.id ?? null,
      },
      include: JOB_INCLUDE,
    });
  }

  private activeAllocation(client: Prisma.TransactionClient | PrismaService, planId: string) {
    return client.quotaAllocation.findFirst({
      where: { productionPlanId: planId, status: QuotaAllocationStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });
  }

  private loraWeights(configSnapshot: Prisma.JsonValue): string | null {
    const snapshot = configSnapshot as { loraWeights?: string } | null;
    return snapshot?.loraWeights ?? null;
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    return plan;
  }
}
