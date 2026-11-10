import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  KnowledgeArticleStatus,
  KnowledgeIndexStatus,
  KnowledgeSource,
  Prisma,
  SupportAudience,
  type SupportKnowledgeArticle,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ChunkingService } from './chunking.service';
import { RetrievalService, type RetrievalOptions } from './retrieval.service';

export const KNOWLEDGE_INDEX_JOB = 'support.knowledge.index';

export interface CreateKnowledgeArticleInput {
  title: string;
  slug: string;
  category: string;
  audience?: SupportAudience;
  locale?: string;
  contentMarkdown: string;
  source?: KnowledgeSource;
  sourceRef?: string | null;
  status?: KnowledgeArticleStatus;
}

export type UpdateKnowledgeArticleInput = Partial<CreateKnowledgeArticleInput>;

const SUMMARY_COLUMNS = [
  'id',
  'title',
  'slug',
  'category',
  'audience',
  'locale',
  'status',
  'source',
  'sourceRef',
  'version',
  'contentHash',
  'indexStatus',
  'indexError',
  'indexedAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof SupportKnowledgeArticle)[];

const SUMMARY_SELECT = Object.fromEntries(
  SUMMARY_COLUMNS.map((column) => [column, true]),
) as Prisma.SupportKnowledgeArticleSelect;

/** Knowledge Base administration (plan §4.5, §6.3). */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunking: ChunkingService,
    private readonly retrieval: RetrievalService,
    private readonly queue: JobQueue,
    private readonly audit: AuditLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  list(query: PaginateQuery) {
    return paginate(query, this.prisma.supportKnowledgeArticle, {
      select: [...SUMMARY_COLUMNS],
      sortableColumns: ['title', 'category', 'status', 'indexStatus', 'updatedAt', 'createdAt'],
      defaultSortBy: [['updatedAt', 'DESC']],
      searchableColumns: ['title', 'slug', 'category'],
      filterableColumns: {
        status: ['$eq', '$in'],
        indexStatus: ['$eq', '$in'],
        audience: ['$eq', '$in'],
        locale: ['$eq'],
        category: ['$eq', '$in'],
      },
    });
  }

  async detail(id: string) {
    const article = await this.prisma.supportKnowledgeArticle.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            chunkIndex: true,
            heading: true,
            content: true,
            tokenCount: true,
            embeddingModel: true,
            embeddingModelVersion: true,
            contentHash: true,
          },
        },
        createdBy: { select: { id: true, fullName: true } },
        updatedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!article) throw new NotFoundException('Knowledge article not found');
    return article;
  }

  async create(input: CreateKnowledgeArticleInput, actorId: string) {
    const contentHash = hashContent(input.contentMarkdown);
    const article = await this.prisma.supportKnowledgeArticle.create({
      data: {
        title: input.title,
        slug: input.slug,
        category: input.category,
        audience: input.audience ?? SupportAudience.MEMBER,
        locale: input.locale ?? 'vi',
        contentMarkdown: input.contentMarkdown,
        source: input.source ?? KnowledgeSource.MANUAL,
        sourceRef: input.sourceRef ?? null,
        status: input.status ?? KnowledgeArticleStatus.DRAFT,
        contentHash,
        indexStatus: KnowledgeIndexStatus.PENDING,
        createdById: actorId,
        updatedById: actorId,
      },
      select: SUMMARY_SELECT,
    });

    await this.audit.record({
      action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_CREATED,
      entityType: 'SupportKnowledgeArticle',
      entityId: article.id,
      movieId: null,
      actorId,
      payload: { slug: article.slug, locale: article.locale, status: article.status },
    });

    if (article.status === KnowledgeArticleStatus.PUBLISHED) {
      await this.enqueueIndex(article.id);
      return this.summary(article.id);
    }
    return article;
  }

  async update(id: string, input: UpdateKnowledgeArticleInput, actorId: string) {
    const current = await this.prisma.supportKnowledgeArticle.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Knowledge article not found');

    const contentChanged = input.contentMarkdown !== undefined && input.contentMarkdown !== current.contentMarkdown;
    const publishedNow =
      input.status === KnowledgeArticleStatus.PUBLISHED && current.status !== KnowledgeArticleStatus.PUBLISHED;
    const needsReindex = contentChanged || publishedNow;

    const article = await this.prisma.$transaction(async (tx) => {
      if (needsReindex) await this.dropChunks(id, tx);

      return tx.supportKnowledgeArticle.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.contentMarkdown !== undefined
            ? { contentMarkdown: input.contentMarkdown, contentHash: hashContent(input.contentMarkdown) }
            : {}),
          ...(contentChanged ? { version: { increment: 1 } } : {}),
          ...(needsReindex
            ? {
                indexStatus: KnowledgeIndexStatus.PENDING,
                indexError: null,
                indexedAt: null,
              }
            : {}),
          updatedById: actorId,
        },
        select: SUMMARY_SELECT,
      });
    });

    await this.audit.record({
      action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_UPDATED,
      entityType: 'SupportKnowledgeArticle',
      entityId: article.id,
      movieId: null,
      actorId,
      payload: { slug: article.slug, version: article.version, reindex: needsReindex },
    });

    if (needsReindex && article.status === KnowledgeArticleStatus.PUBLISHED) {
      await this.enqueueIndex(article.id);
      return this.summary(article.id);
    }
    return article;
  }

  async archive(id: string, actorId: string) {
    const current = await this.prisma.supportKnowledgeArticle.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Knowledge article not found');

    const article = await this.prisma.$transaction(async (tx) => {
      await this.dropChunks(id, tx);
      return tx.supportKnowledgeArticle.update({
        where: { id },
        data: {
          status: KnowledgeArticleStatus.ARCHIVED,
          indexStatus: KnowledgeIndexStatus.PENDING,
          indexError: null,
          indexedAt: null,
          updatedById: actorId,
        },
        select: SUMMARY_SELECT,
      });
    });

    await this.audit.record({
      action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_ARCHIVED,
      entityType: 'SupportKnowledgeArticle',
      entityId: article.id,
      movieId: null,
      actorId,
      payload: { slug: article.slug },
    });
    return article;
  }

  async reindex(id: string, actorId: string) {
    const current = await this.prisma.supportKnowledgeArticle.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('Knowledge article not found');
    if (current.status !== KnowledgeArticleStatus.PUBLISHED) {
      throw new BadRequestException('Only a published article can be indexed');
    }

    await this.prisma.supportKnowledgeArticle.update({
      where: { id },
      data: { indexStatus: KnowledgeIndexStatus.PENDING, indexError: null, indexedAt: null, updatedById: actorId },
    });
    await this.enqueueIndex(id);
    return { articleId: id, indexStatus: KnowledgeIndexStatus.PENDING };
  }

  async reindexAll(actorId: string) {
    const articles = await this.prisma.supportKnowledgeArticle.findMany({
      where: { status: KnowledgeArticleStatus.PUBLISHED },
      select: { id: true },
    });

    await this.prisma.supportKnowledgeArticle.updateMany({
      where: { id: { in: articles.map((article) => article.id) } },
      data: { indexStatus: KnowledgeIndexStatus.PENDING, indexError: null, indexedAt: null, updatedById: actorId },
    });

    for (const article of articles) await this.enqueueIndex(article.id);
    return { total: articles.length, queued: articles.length };
  }

  preview(query: string, options: RetrievalOptions = {}) {
    return this.retrieval.preview(query, options);
  }

  /** GET /admin/support/ai/health (plan §8.4): configuration and index health, no secrets. */
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

  /** Tells the job which article to (re)build; the sweep is the safety net when Redis is down. */
  async enqueueIndex(articleId: string): Promise<void> {
    try {
      await this.queue.add(KNOWLEDGE_INDEX_JOB, { articleId }, `knowledge-${articleId}-${Date.now()}`);
    } catch (error) {
      this.logger.warn(`Could not enqueue indexing for article ${articleId}: ${errorMessage(error)}`);
    }
  }

  private async dropChunks(articleId: string, tx?: PrismaTx): Promise<void> {
    await (tx ?? this.prisma).supportKnowledgeChunk.deleteMany({ where: { articleId } });
  }

  /** Re-reads the summary the create response returns; the inline job may already have indexed it. */
  private async summary(articleId: string) {
    const article = await this.prisma.supportKnowledgeArticle.findUnique({
      where: { id: articleId },
      select: SUMMARY_SELECT,
    });
    if (!article) throw new NotFoundException('Knowledge article not found');
    return article;
  }
}

/** The manifest that decides whether a published article needs to be embedded again. */
export function hashContent(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

export function chunkHash(model: string, content: string): string {
  return createHash('sha256').update(`${model}\u0000${content}`, 'utf8').digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
