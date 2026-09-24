import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AI_MODEL_CATALOG,
  estimateTokenCost,
  JOB_TYPE_ROUTING,
  resolveCatalogKey,
  type AiModelCatalogEntry,
} from './ai-model-catalog';

/** Picks the registered AiModel for a pipeline stage (BR-40: system-selected, never Creator-selected). */
@Injectable()
export class AiModelRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForJob(jobType: GenerationJobType, customFunction?: string | null) {
    const { key, match } = resolveCatalogKey(jobType, customFunction);
    const entry: AiModelCatalogEntry = AI_MODEL_CATALOG[key];
    const model = await this.prisma.aiModel.findFirst({
      where: {
        name: entry.name,
        version: entry.version,
        provider: { name: entry.provider, isActive: true },
      },
    });
    if (!model) {
      throw new ServiceUnavailableException(
        `No active AI model registered for ${jobType} (expected ${entry.provider}/${entry.name}@${entry.version}) — run "npx prisma db seed"`,
      );
    }
    return { model, entry, match, estimatedTokenCost: estimateTokenCost(entry) };
  }

  /** The model and estimate each job type is routed to, for Creator-facing estimates. */
  routingTable() {
    return Object.values(GenerationJobType).map((jobType) => {
      const entry = AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]];
      return {
        jobType,
        provider: entry.provider,
        model: entry.name,
        modality: entry.modality,
        estimatedTokenCost: estimateTokenCost(entry),
      };
    });
  }
}
