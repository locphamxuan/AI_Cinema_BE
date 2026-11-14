import { SupportAudience } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { EmbeddingClient } from 'src/infrastructure/ai/llm-client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { RetrievalService } from './retrieval.service';

function config(aiMode = 'live'): AppConfig {
  return {
    support: {
      aiMode,
      ragTopK: 6,
      ragMinScore: 0.35,
      aiEmbeddingDimensions: 768,
    },
  } as unknown as AppConfig;
}

function vectorRow(articleId: string, chunkIndex: number, score: number | string, extra = {}) {
  return {
    articleId,
    title: `Bài ${articleId}`,
    chunkIndex,
    heading: `heading-${chunkIndex}`,
    content: `content ${articleId}#${chunkIndex}`,
    score,
    ...extra,
  };
}

function textRow(articleId: string, chunkIndex: number, content: string) {
  return {
    articleId,
    chunkIndex,
    heading: `heading-${chunkIndex}`,
    content,
    article: { title: `Bài ${articleId}` },
  };
}

/** Flatten the interpolated values of a `Prisma.sql` template (nested joins included). */
function collectSqlValues(arg: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(arg)) {
    arg.forEach((entry) => collectSqlValues(entry, out));
    return out;
  }
  if (arg !== null && typeof arg === 'object') {
    const record = arg as Record<string, unknown>;
    if ('strings' in record && 'values' in record) return collectSqlValues(record.values, out);
  }
  out.push(arg);
  return out;
}

function sqlTemplateText(arg: unknown): string {
  const record = arg as { strings?: unknown[] };
  return Array.isArray(record?.strings) ? record.strings.join(' ? ').toLowerCase() : '';
}

function buildService(embeddings: EmbeddingClient | null = null, aiMode = 'live') {
  const prisma = {
    supportKnowledgeChunk: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new RetrievalService(prisma as unknown as PrismaService, config(aiMode), embeddings);
  return { service, prisma };
}

describe('RetrievalService.retrieve — empty query', () => {
  it('returns nothing without touching the database for an empty query', async () => {
    const { service, prisma } = buildService();

    await expect(service.retrieve('   ')).resolves.toEqual([]);
    expect(prisma.supportKnowledgeChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('RetrievalService.retrieve — topK / minScore / dedupe (vector path)', () => {
  const FEED = [
    vectorRow('a', 0, '0.95'),
    vectorRow('a', 1, 0.9),
    vectorRow('a', 2, 0.8),
    vectorRow('b', 0, 0.7),
    vectorRow('b', 1, 0.5),
    vectorRow('b', 2, 0.36),
    vectorRow('c', 0, 0.2),
  ];

  function vectorSetup() {
    const embeddings = {
      model: 'mock-embed',
      dimensions: 768,
      embed: jest.fn().mockResolvedValue([Array.from({ length: 768 }, () => 0.1)]),
    };
    const { service, prisma } = buildService(embeddings);
    prisma.$queryRaw.mockResolvedValue(FEED);
    return { service, prisma, embeddings };
  }

  it('embeds the query, runs vector search once and keeps the topK hits above minScore', async () => {
    const { service, prisma, embeddings } = vectorSetup();

    const result = await service.retrieve('Số dư Coin', { topK: 3 });

    expect(embeddings.embed).toHaveBeenCalledWith(['Số dư Coin']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ articleId: 'a', chunkIndex: 0, score: 0.95 });
    expect(result.at(-1)?.score).toBeGreaterThanOrEqual(0.35);
  });

  it('drops rows below minScore but keeps a row exactly at the threshold', async () => {
    const { service, prisma } = vectorSetup();
    prisma.$queryRaw.mockResolvedValue([vectorRow('a', 0, 0.35), vectorRow('a', 1, 0.3499), vectorRow('b', 0, 0.9)]);

    const result = await service.retrieve('Số dư Coin', { topK: 10 });

    expect(result.map((row) => row.score)).toEqual([0.9, 0.35]);
  });

  it('drops non-finite scores (NaN, Infinity, negatives)', async () => {
    const { service, prisma } = vectorSetup();
    prisma.$queryRaw.mockResolvedValue([
      vectorRow('a', 0, 'not-a-number'),
      vectorRow('a', 1, -0.5),
      vectorRow('a', 2, Infinity),
      vectorRow('a', 3, 0.8),
    ]);

    const result = await service.retrieve('Số dư Coin');

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.8);
  });

  it('deduplicates the same article#chunk and enforces at most two chunks per article', async () => {
    const { service, prisma } = vectorSetup();
    prisma.$queryRaw.mockResolvedValue([
      vectorRow('a', 0, 0.9),
      vectorRow('a', 0, 0.9), // duplicate of the previous row
      vectorRow('a', 1, 0.85),
      vectorRow('a', 2, 0.8), // same article, third chunk → dropped (maxPerArticle = 2)
      vectorRow('b', 0, 0.7),
    ]);

    const result = await service.retrieve('Số dư Coin', { topK: 10 });

    expect(result).toHaveLength(3);
    expect(result.filter((row) => row.articleId === 'a')).toHaveLength(2);
    expect(result.find((row) => row.articleId === 'b')).toBeDefined();
  });

  it('honours an explicit maxPerArticle', async () => {
    const { service, prisma } = vectorSetup();
    prisma.$queryRaw.mockResolvedValue([vectorRow('a', 0, 0.9), vectorRow('a', 1, 0.8), vectorRow('b', 0, 0.7)]);

    const result = await service.retrieve('Số dư Coin', { topK: 10, maxPerArticle: 1 });

    expect(result.filter((row) => row.articleId === 'a')).toHaveLength(1);
    expect(result).toHaveLength(2);
  });
});

describe('RetrievalService.retrieve — published / locale / audience filters', () => {
  it('passes the locale, audience and model filters into the raw SQL', async () => {
    const embeddings = {
      model: 'mock-embed',
      dimensions: 768,
      embed: jest.fn().mockResolvedValue([Array.from({ length: 768 }, () => 0.1)]),
    };
    const { service, prisma } = buildService(embeddings);
    prisma.$queryRaw.mockResolvedValue([]);

    await service.retrieve('Số dư Coin', { audience: SupportAudience.MEMBER, locale: 'vi' });

    const queryCall = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray] | undefined;

    if (!queryCall) {
      throw new Error('Expected $queryRaw to be called');
    }

    const sqlArg = queryCall[0];
    expect(sqlTemplateText(sqlArg)).toContain('published');
    expect(sqlTemplateText(sqlArg)).toContain('locale');
    const values = collectSqlValues(sqlArg);
    expect(values).toContain('vi');
    expect(values).toContain('MEMBER');
    expect(values).toContain('ALL');
    expect(values).not.toContain('STAFF');
    expect(values).toContain('mock-embed');
  });

  it('widens the audiences for staff so staff notes are also visible', async () => {
    const embeddings = {
      model: 'mock-embed',
      dimensions: 768,
      embed: jest.fn().mockResolvedValue([Array.from({ length: 768 }, () => 0.1)]),
    };
    const { service, prisma } = buildService(embeddings);
    prisma.$queryRaw.mockResolvedValue([]);

    await service.retrieve('Số dư Coin', { audience: SupportAudience.STAFF });

    const queryCall = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray] | undefined;

    if (!queryCall) {
      throw new Error('Expected $queryRaw to be called');
    }

    const values = collectSqlValues(queryCall[0]);
    expect(values).toContain('STAFF');
    expect(values).toContain('MEMBER');
    expect(values).toContain('ALL');
  });

  it('filters keyword search by status, locale and audience and dedupes terms', async () => {
    const { service, prisma } = buildService();
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue([]);

    await service.retrieve('Coin của tôi COIN hoàn', { audience: SupportAudience.MEMBER });

    const call = prisma.supportKnowledgeChunk.findMany.mock.calls[0] as
      [{ where: Record<string, unknown> }] | undefined;

    if (!call) {
      throw new Error('Expected supportKnowledgeChunk.findMany to be called');
    }

    const where = call[0].where;

    expect(where).toMatchObject({
      article: {
        status: 'PUBLISHED',
        locale: 'vi',
        audience: { in: ['MEMBER', 'ALL'] },
      },
    });

    expect(where.OR).toEqual([
      { content: { contains: 'coin', mode: 'insensitive' } },
      { content: { contains: 'của', mode: 'insensitive' } },
      { content: { contains: 'tôi', mode: 'insensitive' } },
      { content: { contains: 'hoàn', mode: 'insensitive' } },
    ]);
  });
});

describe('RetrievalService.retrieve — keyword fallback', () => {
  it('uses keyword search when no embedding client is configured', async () => {
    const { service, prisma } = buildService(null);
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue([
      textRow('a', 0, 'Số dư Coin của tôi là bao nhiêu'),
      textRow('b', 0, 'Không liên quan, nhưng vẫn trả'),
    ]);

    const result = await service.retrieve('Số dư Coin', { topK: 5 });

    expect(prisma.supportKnowledgeChunk.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(result.map((row) => row.articleId)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(result.every((row) => row.score >= 0.35)).toBe(true);
  });

  it('falls back to keyword search when the embedding dimension does not match', async () => {
    const embeddings = {
      model: 'mock-embed',
      dimensions: 3,
      embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    const { service, prisma } = buildService(embeddings);
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue([]);

    await service.retrieve('Số dư Coin');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.supportKnowledgeChunk.findMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to keyword search when the embedding provider fails', async () => {
    const embeddings = {
      model: 'mock-embed',
      dimensions: 768,
      embed: jest.fn().mockRejectedValue(new Error('provider down')),
    };
    const { service, prisma } = buildService(embeddings);
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue([]);

    await service.retrieve('Số dư Coin');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.supportKnowledgeChunk.findMany).toHaveBeenCalledTimes(1);
  });

  it('clips keyword hits at topK', async () => {
    const { service, prisma } = buildService(null);
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => textRow(`a-${index}`, 0, 'Số dư Coin')),
    );

    const result = await service.retrieve('Số dư Coin', { topK: 3 });

    expect(result).toHaveLength(3);
  });
});

describe('RetrievalService.preview', () => {
  it('groups chunks per article with the admin-friendly limits', async () => {
    const { service, prisma } = buildService(null);
    prisma.supportKnowledgeChunk.findMany.mockResolvedValue([
      textRow('a', 0, 'Số dư Coin là bao nhiêu'),
      textRow('a', 1, 'Số dư Coin là bao nhiêu'),
      textRow('a', 2, 'Số dư Coin là bao nhiêu'),
      textRow('a', 3, 'Số dư Coin là bao nhiêu'),
      textRow('b', 0, 'Số dư Coin là bao nhiêu'),
    ]);

    const preview = await service.preview('Số dư Coin', {});

    expect(preview.totalFound).toBe(4); // 3 chunks of a (maxPerArticle) + 1 of b
    expect(preview.articles).toHaveLength(2);
    expect(preview.articles.find((article) => article.articleId === 'a')?.chunks).toHaveLength(3);
    expect(preview.articles.find((article) => article.articleId === 'b')?.chunks).toHaveLength(1);
  });
});
