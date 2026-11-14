import { KnowledgeArticleStatus, KnowledgeIndexStatus } from '@prisma/client';
import type { EmbeddingClient } from 'src/infrastructure/ai/llm-client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { ChunkingService, MarkdownChunk } from './chunking.service';
import { hashContent } from './knowledge-hash';
import { KnowledgeIndexJob } from './knowledge-index.job';
import { KNOWLEDGE_INDEX_JOB } from './knowledge.service';

type Handler = (data?: { articleId: string }) => Promise<void>;

describe('KnowledgeIndexJob', () => {
  const tx = {
    supportKnowledgeChunk: { deleteMany: jest.fn() },
    supportKnowledgeArticle: { update: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    supportKnowledgeArticle: { findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    supportKnowledgeChunk: { count: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const chunking = { chunk: jest.fn() };
  const queue = { register: jest.fn(), every: jest.fn() };
  const audit = { record: jest.fn() };
  const embeddings = { model: 'embed-1', modelVersion: 'v1', dimensions: 3, embed: jest.fn() };
  const build = (client: EmbeddingClient | null = embeddings) =>
    new KnowledgeIndexJob(
      prisma as unknown as PrismaService,
      chunking as unknown as ChunkingService,
      queue as unknown as JobQueue,
      audit as unknown as AuditLogService,
      client,
    );

  const MARKDOWN = '# Gói Tháng\nNội dung';
  const article = (over: Record<string, unknown> = {}) => ({
    id: 'art-1',
    title: 'Gói Tháng',
    status: KnowledgeArticleStatus.PUBLISHED,
    contentMarkdown: MARKDOWN,
    ...over,
  });
  const chunks = (n: number): MarkdownChunk[] =>
    Array.from({ length: n }, (_, i) => ({ chunkIndex: i, heading: 'H', content: `c${i}`, tokenCount: 2 }));
  const notIndexedYet = () => {
    // isCurrent() reads the article a second time with a narrower select.
    prisma.supportKnowledgeArticle.findUnique
      .mockResolvedValueOnce(article())
      .mockResolvedValueOnce({ contentHash: null, indexStatus: KnowledgeIndexStatus.PENDING, indexedAt: null });
    prisma.supportKnowledgeChunk.count.mockResolvedValue(0);
    prisma.supportKnowledgeChunk.findFirst.mockResolvedValue(null);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    embeddings.embed.mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])));
    chunking.chunk.mockReturnValue(chunks(2));
  });

  describe('onModuleInit', () => {
    it('registers the index job with retries and the minute sweep', () => {
      build().onModuleInit();
      expect(queue.register).toHaveBeenCalledWith(
        KNOWLEDGE_INDEX_JOB,
        expect.any(Function),
        expect.objectContaining({ attempts: 3, backoffMs: 10_000, onFailed: expect.any(Function) }),
      );
      expect(queue.every).toHaveBeenCalledWith('support.knowledge.sweep', 60_000, expect.any(Function));
    });

    it('marks the article FAILED when the queue gives up on it', async () => {
      build().onModuleInit();
      const { onFailed } = (queue.register.mock.calls as unknown[][])[0][2] as {
        onFailed: (data: { articleId: string }, error: unknown) => Promise<void>;
      };
      await onFailed({ articleId: 'art-1' }, 'x'.repeat(3_000));

      const [[{ data }]] = prisma.supportKnowledgeArticle.updateMany.mock.calls as [
        [{ data: { indexStatus: string; indexError: string } }],
      ];
      expect(data.indexStatus).toBe(KnowledgeIndexStatus.FAILED);
      expect(data.indexError).toHaveLength(2_000);
    });
  });

  describe('indexArticle', () => {
    it('chunks, embeds, replaces the chunks and marks the article INDEXED', async () => {
      notIndexedYet();
      await build().indexArticle('art-1');

      expect(prisma.supportKnowledgeArticle.updateMany).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { indexStatus: KnowledgeIndexStatus.INDEXING, indexError: null },
      });
      expect(chunking.chunk).toHaveBeenCalledWith(MARKDOWN, 'Gói Tháng');
      expect(tx.supportKnowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { articleId: 'art-1' } });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.supportKnowledgeArticle.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: expect.objectContaining({
          indexStatus: KnowledgeIndexStatus.INDEXED,
          indexError: null,
          contentHash: hashContent(MARKDOWN),
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_INDEXED,
          entityId: 'art-1',
          payload: { chunkCount: 2, model: 'embed-1' },
        }),
      );
    });

    it('embeds in batches of 32', async () => {
      notIndexedYet();
      chunking.chunk.mockReturnValue(chunks(33));
      await build().indexArticle('art-1');

      expect(embeddings.embed).toHaveBeenCalledTimes(2);
      expect((embeddings.embed.mock.calls as unknown[][])[0][0]).toHaveLength(32);
      expect((embeddings.embed.mock.calls as unknown[][])[1][0]).toHaveLength(1);
    });

    it('clears the old chunks without an insert when the article has no content left', async () => {
      notIndexedYet();
      chunking.chunk.mockReturnValue([]);
      await build().indexArticle('art-1');

      expect(embeddings.embed).not.toHaveBeenCalled();
      expect(tx.supportKnowledgeChunk.deleteMany).toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.supportKnowledgeArticle.update).toHaveBeenCalled();
    });

    it('skips an article that is already indexed with the same content and model', async () => {
      prisma.supportKnowledgeArticle.findUnique.mockResolvedValueOnce(article()).mockResolvedValueOnce({
        contentHash: hashContent(MARKDOWN),
        indexStatus: KnowledgeIndexStatus.INDEXED,
        indexedAt: new Date(),
      });
      prisma.supportKnowledgeChunk.count.mockResolvedValue(3);
      prisma.supportKnowledgeChunk.findFirst.mockResolvedValue({ embeddingModel: 'embed-1' });

      await build().indexArticle('art-1');

      expect(prisma.supportKnowledgeArticle.updateMany).not.toHaveBeenCalled();
      expect(embeddings.embed).not.toHaveBeenCalled();
    });

    it('re-indexes when the embedding model changed', async () => {
      prisma.supportKnowledgeArticle.findUnique.mockResolvedValueOnce(article()).mockResolvedValueOnce({
        contentHash: hashContent(MARKDOWN),
        indexStatus: KnowledgeIndexStatus.INDEXED,
        indexedAt: new Date(),
      });
      prisma.supportKnowledgeChunk.count.mockResolvedValue(3);
      prisma.supportKnowledgeChunk.findFirst.mockResolvedValue({ embeddingModel: 'embed-0' });

      await build().indexArticle('art-1');
      expect(embeddings.embed).toHaveBeenCalled();
    });

    it.each([
      ['missing', null],
      ['not published', article({ status: KnowledgeArticleStatus.DRAFT })],
    ])('does nothing for an article that is %s', async (_label, row) => {
      prisma.supportKnowledgeArticle.findUnique.mockResolvedValueOnce(row);
      await build().indexArticle('art-1');

      expect(prisma.supportKnowledgeArticle.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('marks the article FAILED when no embedding provider is configured', async () => {
      await build(null).indexArticle('art-1');

      expect(prisma.supportKnowledgeArticle.findUnique).not.toHaveBeenCalled();
      expect(prisma.supportKnowledgeArticle.updateMany).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { indexStatus: KnowledgeIndexStatus.FAILED, indexError: 'Embedding provider is not configured' },
      });
    });

    it('marks FAILED and rethrows when the provider returns the wrong number of vectors', async () => {
      notIndexedYet();
      embeddings.embed.mockResolvedValueOnce([[0.1]]);

      await expect(build().indexArticle('art-1')).rejects.toThrow('wrong number of vectors');
      expect(prisma.supportKnowledgeArticle.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'art-1' },
        data: { indexStatus: KnowledgeIndexStatus.FAILED, indexError: expect.stringContaining('wrong number') },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores a second call for an article already being indexed, and allows it again afterwards', async () => {
      notIndexedYet();
      let release!: (v: number[][]) => void;
      embeddings.embed.mockReturnValueOnce(new Promise<number[][]>((resolve) => (release = resolve)));
      const job = build();

      const first = job.indexArticle('art-1');
      await new Promise((resolve) => setImmediate(resolve));
      await job.indexArticle('art-1');
      expect(prisma.supportKnowledgeArticle.findUnique).toHaveBeenCalledTimes(2);

      release([
        [1, 2, 3],
        [4, 5, 6],
      ]);
      await first;

      notIndexedYet();
      await job.indexArticle('art-1');
      expect(prisma.supportKnowledgeArticle.findUnique).toHaveBeenCalledTimes(4);
    });
  });

  describe('sweep', () => {
    const runSweep = async (job: KnowledgeIndexJob) => {
      job.onModuleInit();
      const handler = (queue.every.mock.calls as unknown[][])[0][2] as Handler;
      await handler();
    };

    it('returns stuck INDEXING rows to PENDING and indexes the pending ones', async () => {
      prisma.supportKnowledgeArticle.findMany.mockResolvedValue([{ id: 'art-1' }]);
      notIndexedYet();

      const before = Date.now();
      await runSweep(build());
      const after = Date.now();

      const [[reset]] = prisma.supportKnowledgeArticle.updateMany.mock.calls as [
        [{ where: { indexStatus: string; updatedAt: { lt: Date } }; data: unknown }],
      ];
      expect(reset.where.indexStatus).toBe(KnowledgeIndexStatus.INDEXING);
      expect(reset.data).toEqual({ indexStatus: KnowledgeIndexStatus.PENDING });
      // Rows untouched for 10 minutes: the cutoff is taken during the sweep, so it sits in that window.
      const cutoff = reset.where.updatedAt.lt.getTime();
      expect(cutoff).toBeGreaterThanOrEqual(before - 10 * 60_000);
      expect(cutoff).toBeLessThanOrEqual(after - 10 * 60_000);
      expect(prisma.supportKnowledgeArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: KnowledgeArticleStatus.PUBLISHED, indexStatus: KnowledgeIndexStatus.PENDING },
          take: 20,
        }),
      );
      expect(tx.supportKnowledgeArticle.update).toHaveBeenCalled();
    });

    it('keeps going when one article fails', async () => {
      prisma.supportKnowledgeArticle.findMany.mockResolvedValue([{ id: 'art-1' }, { id: 'art-2' }]);
      prisma.supportKnowledgeArticle.findUnique.mockRejectedValueOnce(new Error('db hiccup'));
      prisma.supportKnowledgeArticle.findUnique
        .mockResolvedValueOnce(article({ id: 'art-2' }))
        .mockResolvedValueOnce({ contentHash: null, indexStatus: KnowledgeIndexStatus.PENDING, indexedAt: null });
      prisma.supportKnowledgeChunk.count.mockResolvedValue(0);
      prisma.supportKnowledgeChunk.findFirst.mockResolvedValue(null);

      await expect(runSweep(build())).resolves.toBeUndefined();
      expect(tx.supportKnowledgeArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'art-2' } }),
      );
    });

    it('does nothing more when no article is pending', async () => {
      prisma.supportKnowledgeArticle.findMany.mockResolvedValue([]);
      await runSweep(build());
      expect(prisma.supportKnowledgeArticle.findUnique).not.toHaveBeenCalled();
    });
  });
});
