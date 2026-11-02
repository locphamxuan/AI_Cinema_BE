import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { KnowledgeArticleStatus, KnowledgeIndexStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { EMBEDDING_CLIENT, type EmbeddingClient } from 'src/infrastructure/ai/llm-client';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ChunkingService, type MarkdownChunk } from './chunking.service';
import { KNOWLEDGE_INDEX_JOB, chunkHash, hashContent } from './knowledge.service';

const SWEEP_MS = 60_000;
const STUCK_INDEXING_MS = 10 * 60_000;
const BATCH_SIZE = 32;

interface IndexJobData {
  articleId: string;
}

/**
 * Builds the RAG index (plan §4.5): chunk, embed in batches, replace the article's chunks and
 * mark it INDEXED. The sweep picks up articles seeded or edited while Redis was down; a stuck
 * INDEXING row is returned to PENDING after ten minutes so a crash cannot hide it forever.
 */
@Injectable()
export class KnowledgeIndexJob implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeIndexJob.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunking: ChunkingService,
    private readonly queue: JobQueue,
    private readonly audit: AuditLogService,
    @Optional() @Inject(EMBEDDING_CLIENT) private readonly embeddings: EmbeddingClient | null,
  ) {}

  onModuleInit(): void {
    this.queue.register<IndexJobData>(KNOWLEDGE_INDEX_JOB, ({ articleId }) => this.indexArticle(articleId), {
      attempts: 3,
      backoffMs: 10_000,
      onFailed: ({ articleId }, error) => this.markFailed(articleId, error),
    });
    this.queue.every('support.knowledge.sweep', SWEEP_MS, () => this.sweep());
  }

  /** Indexes one article; safe to call twice: the second call sees it is already running. */
  async indexArticle(articleId: string): Promise<void> {
    if (this.running.has(articleId)) return;
    if (!this.embeddings) {
      await this.markFailed(articleId, new Error('Embedding provider is not configured'));
      return;
    }
    this.running.add(articleId);

    try {
      const article = await this.prisma.supportKnowledgeArticle.findUnique({ where: { id: articleId } });
      if (!article) return;
      if (article.status !== KnowledgeArticleStatus.PUBLISHED) return;

      const contentHash = hashContent(article.contentMarkdown);
      if (await this.isCurrent(article.id, contentHash, this.embeddings.model)) return;

      await this.prisma.supportKnowledgeArticle.updateMany({
        where: { id: articleId },
        data: { indexStatus: KnowledgeIndexStatus.INDEXING, indexError: null },
      });

      const chunks = this.chunking.chunk(article.contentMarkdown, article.title);
      const vectors = await this.embedAll(chunks);

      await this.prisma.$transaction(async (tx) => {
        await tx.supportKnowledgeChunk.deleteMany({ where: { articleId } });
        if (chunks.length) await this.insertChunks(article.id, chunks, vectors, tx);
        await tx.supportKnowledgeArticle.update({
          where: { id: articleId },
          data: {
            indexStatus: KnowledgeIndexStatus.INDEXED,
            indexError: null,
            indexedAt: new Date(),
            contentHash,
          },
        });
      });

      await this.audit.record({
        action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_INDEXED,
        entityType: 'SupportKnowledgeArticle',
        entityId: articleId,
        projectId: null,
        actorId: null,
        payload: { chunkCount: chunks.length, model: this.embeddings.model },
      });
      this.logger.log(`Indexed article ${articleId}: ${chunks.length} chunks with ${this.embeddings.model}`);
    } catch (error) {
      await this.markFailed(articleId, error);
      throw error;
    } finally {
      this.running.delete(articleId);
    }
  }

  private async isCurrent(articleId: string, contentHash: string, model: string): Promise<boolean> {
    const [article, chunks, first] = await Promise.all([
      this.prisma.supportKnowledgeArticle.findUnique({
        where: { id: articleId },
        select: { contentHash: true, indexStatus: true, indexedAt: true },
      }),
      this.prisma.supportKnowledgeChunk.count({ where: { articleId } }),
      this.prisma.supportKnowledgeChunk.findFirst({
        where: { articleId },
        select: { embeddingModel: true },
      }),
    ]);
    return (
      Boolean(article?.indexedAt) &&
      article?.indexStatus === KnowledgeIndexStatus.INDEXED &&
      article.contentHash === contentHash &&
      chunks > 0 &&
      first?.embeddingModel === model
    );
  }

  private async embedAll(chunks: MarkdownChunk[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
      const batch = chunks.slice(start, start + BATCH_SIZE);
      const batchVectors = await this.embeddings!.embed(batch.map((chunk) => chunk.content));
      if (batchVectors.length !== batch.length)
        throw new Error('Embedding provider returned the wrong number of vectors');
      vectors.push(...batchVectors);
    }
    return vectors;
  }

  /**
   * Prisma cannot write the `Unsupported("vector")` column, so the rows go in with one
   * parameterised INSERT and a `::vector` cast per embedding.
   */
  private async insertChunks(
    articleId: string,
    chunks: MarkdownChunk[],
    vectors: number[][],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const model = this.embeddings!.model;
    const modelVersion = this.embeddings!.modelVersion ?? null;
    const rows = chunks.map(
      (chunk, index) =>
        Prisma.sql`(
        ${randomUUID()}::uuid,
        ${articleId}::uuid,
        ${chunk.chunkIndex},
        ${chunk.heading},
        ${chunk.content},
        ${chunk.tokenCount},
        ${toVectorLiteral(vectors[index])}::vector,
        ${model},
        ${modelVersion},
        ${chunkHash(model, chunk.content)}
      )`,
    );

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "support_knowledge_chunks"
        ("id", "article_id", "chunk_index", "heading", "content", "token_count",
         "embedding", "embedding_model", "embedding_model_version", "content_hash")
      VALUES ${Prisma.join(rows)}
    `);
  }

  private async markFailed(articleId: string, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    await this.prisma.supportKnowledgeArticle.updateMany({
      where: { id: articleId },
      data: { indexStatus: KnowledgeIndexStatus.FAILED, indexError: message },
    });
    this.logger.warn(`Indexing article ${articleId} failed: ${message}`);
  }

  private async sweep(): Promise<void> {
    await this.prisma.supportKnowledgeArticle.updateMany({
      where: {
        indexStatus: KnowledgeIndexStatus.INDEXING,
        updatedAt: { lt: new Date(Date.now() - STUCK_INDEXING_MS) },
      },
      data: { indexStatus: KnowledgeIndexStatus.PENDING },
    });

    const pending = await this.prisma.supportKnowledgeArticle.findMany({
      where: { status: KnowledgeArticleStatus.PUBLISHED, indexStatus: KnowledgeIndexStatus.PENDING },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: { id: true },
    });

    for (const { id } of pending) {
      try {
        await this.indexArticle(id);
      } catch {
        // Already marked FAILED; the next sweep does not retry a failed article until an Admin reindexes it.
      }
    }
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
