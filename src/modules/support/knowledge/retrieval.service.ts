import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, SupportAudience } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { EMBEDDING_CLIENT, type EmbeddingClient } from 'src/infrastructure/ai/llm-client';
import type { RetrievedKnowledge } from '../shared/support-view';

export interface RetrievalOptions {
  locale?: string;
  audience?: SupportAudience;
  topK?: number;
  minScore?: number;
  /** Plan §4.4: at most two chunks of the same article keep the prompt diverse. */
  maxPerArticle?: number;
}

interface VectorRow {
  articleId: string;
  title: string;
  chunkIndex: number;
  heading: string;
  content: string;
  score: number | string;
}

interface TextRow {
  articleId: string;
  chunkIndex: number;
  heading: string;
  content: string;
  article: { title: string };
}

interface ScoredRow {
  articleId: string;
  title: string;
  chunkIndex: number;
  heading: string;
  content: string;
  score: number | string;
}

/**
 * RAG retrieval (plan §4.3–4.4). Vector search runs in Postgres because Prisma cannot read the
 * `Unsupported("vector")` column: `1 - (embedding <=> query)` is cosine similarity. When the
 * embedding provider is unavailable the service degrades to a keyword search instead of failing
 * the chat turn.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(EMBEDDING_CLIENT) private readonly embeddings: EmbeddingClient | null,
  ) {}

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievedKnowledge[]> {
    const text = query.trim();
    if (!text) return [];

    const topK = options.topK ?? this.config.support.ragTopK;
    // Hashed mock vectors share only exact tokens, so their cosine similarity is much lower than
    // a real embedding model's; the e2e threshold is relaxed instead of returning nothing.
    const minScore =
      options.minScore ?? (this.config.support.aiMode === 'mock' ? 0.05 : this.config.support.ragMinScore);
    const maxPerArticle = options.maxPerArticle ?? 2;
    const locale = options.locale ?? 'vi';
    const audience = options.audience ?? SupportAudience.MEMBER;
    const audiences = this.audiencesFor(audience);

    if (this.embeddings) {
      try {
        const [vector] = await this.embeddings.embed([text]);
        if (vector?.length === this.config.support.aiEmbeddingDimensions) {
          const rows = await this.vectorSearch(vector, {
            locale,
            audiences,
            model: this.embeddings.model,
            limit: topK * 4,
          });
          return this.shape(rows, topK, minScore, maxPerArticle);
        }
        this.logger.warn('Embedding dimension does not match the vector column; using keyword search');
      } catch (error) {
        this.logger.warn(`Vector search unavailable (${errorMessage(error)}); using keyword search`);
      }
    }

    const rows = await this.keywordSearch(text, { locale, audiences, limit: topK * 4 });
    return this.shape(rows, topK, 0, maxPerArticle);
  }

  /** Admin preview (plan §6.3): the same retrieval, grouped per article for the screen. */
  async preview(query: string, options: RetrievalOptions = {}) {
    const chunks = await this.retrieve(query, { ...options, topK: options.topK ?? 8, maxPerArticle: 3 });
    const byArticle = new Map<string, { articleId: string; title: string; chunks: typeof chunks }>();
    for (const chunk of chunks) {
      const entry = byArticle.get(chunk.articleId) ?? { articleId: chunk.articleId, title: chunk.title, chunks: [] };
      entry.chunks.push(chunk);
      byArticle.set(chunk.articleId, entry);
    }
    return { articles: [...byArticle.values()], totalFound: chunks.length };
  }

  private audiencesFor(audience: SupportAudience): SupportAudience[] {
    return audience === SupportAudience.MEMBER
      ? [SupportAudience.MEMBER, SupportAudience.ALL]
      : [SupportAudience.MEMBER, SupportAudience.STAFF, SupportAudience.ALL];
  }

  private vectorSearch(
    vector: number[],
    options: { locale: string; audiences: SupportAudience[]; model: string; limit: number },
  ): Promise<VectorRow[]> {
    const literal = toVectorLiteral(vector);
    return this.prisma.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT c."article_id" AS "articleId",
             a."title" AS "title",
             c."chunk_index" AS "chunkIndex",
             c."heading" AS "heading",
             c."content" AS "content",
             1 - (c."embedding" <=> ${literal}::vector) AS "score"
      FROM "support_knowledge_chunks" c
      JOIN "support_knowledge_articles" a ON a."id" = c."article_id"
      WHERE a."status"::text = 'PUBLISHED'
        AND a."locale" = ${options.locale}
        AND a."audience"::text IN (${Prisma.join(options.audiences)})
        AND c."embedding_model" = ${options.model}
        AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${options.limit}
    `);
  }

  private async keywordSearch(
    query: string,
    options: { locale: string; audiences: SupportAudience[]; limit: number },
  ): Promise<VectorRow[]> {
    const terms = [
      ...new Set(
        query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length >= 2),
      ),
    ].slice(0, 8);
    const rows = await this.prisma.supportKnowledgeChunk.findMany({
      where: {
        article: {
          status: 'PUBLISHED',
          locale: options.locale,
          audience: { in: options.audiences },
        },
        ...(terms.length
          ? { OR: terms.map((term) => ({ content: { contains: term, mode: 'insensitive' as const } })) }
          : {}),
      },
      select: {
        articleId: true,
        chunkIndex: true,
        heading: true,
        content: true,
        article: { select: { title: true } },
      },
      take: options.limit,
    });

    return (rows as TextRow[]).map((row) => {
      const lower = row.content.toLowerCase();
      const matched = terms.filter((term) => lower.includes(term)).length;
      // Keyword matches are weaker than cosine matches but still above the 0.35 floor.
      const score = terms.length ? 0.4 + 0.5 * (matched / terms.length) : 0.5;
      return { ...row, title: row.article.title, score };
    });
  }

  private shape(rows: ScoredRow[], topK: number, minScore: number, maxPerArticle: number): RetrievedKnowledge[] {
    const perArticle = new Map<string, number>();
    const seen = new Set<string>();
    const result: RetrievedKnowledge[] = [];

    for (const row of [...rows].sort((a, b) => Number(b.score) - Number(a.score))) {
      const score = Number(row.score);
      if (!Number.isFinite(score) || score < minScore) continue;

      const key = `${row.articleId}#${row.chunkIndex}`;
      if (seen.has(key)) continue;

      const used = perArticle.get(row.articleId) ?? 0;
      if (used >= maxPerArticle) continue;

      seen.add(key);
      perArticle.set(row.articleId, used + 1);
      result.push({
        articleId: row.articleId,
        title: row.title,
        chunkIndex: Number(row.chunkIndex),
        heading: row.heading,
        content: row.content,
        score: Math.round(score * 10_000) / 10_000,
      });
      if (result.length >= topK) break;
    }

    return result;
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
