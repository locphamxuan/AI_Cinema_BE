import { Inject, Injectable } from '@nestjs/common';
import { KnowledgeArticleStatus, KnowledgeIndexStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

/** Reports how the assistant is configured and how fresh its index is; never prints a key. */
@Injectable()
export class SupportAiHealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async health() {
    const [indexedChunks, failedArticles, pendingArticles, lastIndexed] = await Promise.all([
      this.prisma.supportKnowledgeChunk.count(),
      this.prisma.supportKnowledgeArticle.count({
        where: { status: KnowledgeArticleStatus.PUBLISHED, indexStatus: KnowledgeIndexStatus.FAILED },
      }),
      this.prisma.supportKnowledgeArticle.count({
        where: { status: KnowledgeArticleStatus.PUBLISHED, indexStatus: KnowledgeIndexStatus.PENDING },
      }),
      this.prisma.supportKnowledgeArticle.findFirst({
        where: { indexedAt: { not: null } },
        orderBy: { indexedAt: 'desc' },
        select: { indexedAt: true },
      }),
    ]);

    return {
      mode: this.config.support.aiMode,
      chatModel: this.config.support.aiChatModel,
      chatConfigured: Boolean(this.config.support.aiChatBaseUrl && this.config.support.aiChatApiKey),
      embeddingModel: this.config.support.aiEmbeddingModel,
      embeddingDimensions: this.config.support.aiEmbeddingDimensions,
      embeddingConfigured: Boolean(this.config.support.aiEmbeddingApiKey),
      indexedChunks,
      failedArticles,
      pendingArticles,
      lastIndexedAt: lastIndexed?.indexedAt ?? null,
    };
  }
}
