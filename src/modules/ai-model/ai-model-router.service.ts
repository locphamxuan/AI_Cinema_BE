import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { catalogEntryForJobType } from './ai-model-catalog';

/** Picks the registered AiModel for a pipeline stage (BR-40: system-selected, never Creator-selected). */
@Injectable()
export class AiModelRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForJobType(jobType: GenerationJobType) {
    const entry = catalogEntryForJobType(jobType);
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
    return model;
  }
}
