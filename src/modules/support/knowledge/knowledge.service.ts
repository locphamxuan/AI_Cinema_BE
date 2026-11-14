import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KnowledgeArticleStatus, KnowledgeIndexStatus, KnowledgeSource, SupportAudience } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { errorMessage, hashContent } from './knowledge-hash';
import { SUMMARY_COLUMNS, SUMMARY_SELECT } from './knowledge-summary';
import { ChunkingService } from './chunking.service';
import { SupportAiHealthService } from './support-ai-health.service';
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
    private readonly aiHealth: SupportAiHealthService,
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
      projectId: null,
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
      projectId: null,
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
      projectId: null,
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
  health() {
    return this.aiHealth.health();
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
