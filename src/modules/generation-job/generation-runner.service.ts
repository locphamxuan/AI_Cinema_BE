import { Inject, Injectable } from '@nestjs/common';
import { GenerationJobStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AI_MODEL_CATALOG, resolveCatalogKey } from 'src/modules/ai-model/ai-model-catalog';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { PRODUCTION_EVENT } from 'src/modules/audit-log/production-events';
import { JOB_INCLUDE, RUNNABLE } from './generation-job.rules';
import { settleJob } from './generation-billing';
import { loraWeightsOf } from './generation-context';
import {
  AI_GENERATION_PROVIDER,
  assetTypeFor,
  tokenCostOf,
  type AiGenerationProvider,
  type AiGenerationResult,
} from './ai-generation-provider';

/**
 * Runs one queued job through the AI provider, stores its output and charges the quota.
 * Called by GenerationQueue, either right away (no Redis) or from the BullMQ worker.
 */
@Injectable()
export class GenerationRunner {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_GENERATION_PROVIDER) private readonly aiProvider: AiGenerationProvider,
    private readonly auditLog: AuditLogService,
  ) {}

  async execute(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId }, include: JOB_INCLUDE });
    // A job cancelled or discarded while it waited in the queue is left alone.
    if (!job || !RUNNABLE.includes(job.status)) return job;

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
      const errorMessage = error instanceof Error ? error.message : 'AI provider error';
      const failed = await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: GenerationJobStatus.FAILED, errorMessage },
        include: JOB_INCLUDE,
      });
      await this.record(PRODUCTION_EVENT.GENERATION_FAILED, jobId, { jobType: job.jobType, errorMessage });
      return failed;
    }

    const tokenCost = tokenCostOf(model, result.outputUnits);
    const completed = await this.prisma.$transaction(async (tx) => {
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
    await this.record(PRODUCTION_EVENT.GENERATION_COMPLETED, jobId, {
      jobType: job.jobType,
      tokenCost: Number(completed.resourceCost),
    });
    return completed;
  }

  private record(action: string, jobId: string, payload: Record<string, unknown>) {
    return this.auditLog.record({ action, entityType: 'GenerationJob', entityId: jobId, actorId: null, payload });
  }
}
