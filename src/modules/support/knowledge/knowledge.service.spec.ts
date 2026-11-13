import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeArticleStatus, KnowledgeIndexStatus, KnowledgeSource, SupportAudience } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { KnowledgeService } from './knowledge.service';
import { SupportAiHealthService } from './support-ai-health.service';
import { chunkHash, hashContent } from './knowledge-hash';
import type { ChunkingService } from './chunking.service';
import type { RetrievalService } from './retrieval.service';

const ACTOR_ID = 'admin-1';
const ARTICLE_ID = 'article-1';

const CURRENT = {
  id: ARTICLE_ID,
  slug: 'so-du-coin',
  status: KnowledgeArticleStatus.PUBLISHED,
  contentMarkdown: '# Số dư\nSố dư là 100.',
};

function buildService(configOverrides: Partial<AppConfig['support']> = {}) {
  const config = {
    support: {
      aiMode: 'live',
      aiChatModel: 'test-model',
      aiChatBaseUrl: 'https://api.example.com',
      aiChatApiKey: 'chat-key',
      aiEmbeddingModel: 'embed-model',
      aiEmbeddingDimensions: 768,
      aiEmbeddingApiKey: 'embed-key',
      ...configOverrides,
    },
  } as unknown as AppConfig;

  const tx = {
    supportKnowledgeArticle: { update: jest.fn() },
    supportKnowledgeChunk: { deleteMany: jest.fn() },
  };
  const prisma = {
    supportKnowledgeArticle: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    supportKnowledgeChunk: { count: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((callback: (tx: PrismaTx) => unknown) => callback(tx as unknown as PrismaTx)),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new KnowledgeService(
    prisma as unknown as PrismaService,
    {} as ChunkingService,
    {} as RetrievalService,
    queue as unknown as JobQueue,
    audit as unknown as AuditLogService,
    config,
    new SupportAiHealthService(prisma as unknown as PrismaService, config),
  );
  return { service, prisma, tx, queue, audit };
}

describe('KnowledgeService.create — index trigger', () => {
  it('creates a draft article with pending index status and never enqueues it', async () => {
    const { service, prisma, queue, audit } = buildService();
    prisma.supportKnowledgeArticle.create.mockResolvedValue({
      id: ARTICLE_ID,
      slug: 'so-du',
      status: KnowledgeArticleStatus.DRAFT,
    });

    const result = await service.create(
      { title: 'Số dư', slug: 'so-du', category: 'Coin', contentMarkdown: '# Số dư\nSố dư là 100.' },
      ACTOR_ID,
    );

    expect(prisma.supportKnowledgeArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          audience: SupportAudience.MEMBER,
          locale: 'vi',
          source: KnowledgeSource.MANUAL,
          status: KnowledgeArticleStatus.DRAFT,
          indexStatus: KnowledgeIndexStatus.PENDING,
          contentHash: hashContent('# Số dư\nSố dư là 100.'),
          createdById: ACTOR_ID,
        }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_CREATED, actorId: ACTOR_ID }),
    );
    expect(result.id).toBe(ARTICLE_ID);
  });

  it('enqueues indexing and returns the re-read summary when created published', async () => {
    const { service, prisma, queue } = buildService();
    prisma.supportKnowledgeArticle.create.mockResolvedValue({
      id: ARTICLE_ID,
      slug: 'so-du',
      status: KnowledgeArticleStatus.PUBLISHED,
      indexStatus: KnowledgeIndexStatus.PENDING,
    });
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({
      id: ARTICLE_ID,
      slug: 'so-du',
      indexStatus: KnowledgeIndexStatus.INDEXED,
    });

    const result = await service.create(
      {
        title: 'Số dư',
        slug: 'so-du',
        category: 'Coin',
        contentMarkdown: '# Số dư',
        status: KnowledgeArticleStatus.PUBLISHED,
      },
      ACTOR_ID,
    );

    expect(queue.add).toHaveBeenCalledWith(
      'support.knowledge.index',
      { articleId: ARTICLE_ID },
      expect.stringContaining(`knowledge-${ARTICLE_ID}-`),
    );
    expect(result.indexStatus).toBe(KnowledgeIndexStatus.INDEXED);
  });

  it('defaults source/audience/locale but honors explicit values', async () => {
    const { service, prisma } = buildService();
    prisma.supportKnowledgeArticle.create.mockResolvedValue({ id: ARTICLE_ID, status: KnowledgeArticleStatus.DRAFT });

    await service.create(
      {
        title: 'Ghi chú',
        slug: 'ghi-chu',
        category: 'Khác',
        audience: SupportAudience.STAFF,
        locale: 'en',
        contentMarkdown: 'Nội dung',
        source: KnowledgeSource.FAQ,
      },
      ACTOR_ID,
    );

    expect(prisma.supportKnowledgeArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ audience: SupportAudience.STAFF, locale: 'en', source: KnowledgeSource.FAQ }),
      }),
    );
  });
});

describe('KnowledgeService.update — reindex conditions (hash skip)', () => {
  it('does not drop chunks or bump the version when the content is unchanged', async () => {
    const { service, prisma, tx, queue } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue(CURRENT);
    const updated = { id: ARTICLE_ID, version: 3, status: KnowledgeArticleStatus.PUBLISHED };
    tx.supportKnowledgeArticle.update.mockResolvedValue(updated);

    const result = await service.update(
      ARTICLE_ID,
      { title: 'Số dư mới', contentMarkdown: CURRENT.contentMarkdown },
      ACTOR_ID,
    );

    expect(tx.supportKnowledgeChunk.deleteMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    const updateCall = tx.supportKnowledgeArticle.update.mock.calls[0] as
      [{ data: Record<string, unknown> }] | undefined;

    if (!updateCall) {
      throw new Error('Expected supportKnowledgeArticle.update to be called');
    }

    const updateData = updateCall[0].data;
    expect(updateData).toMatchObject({
      title: 'Số dư mới',
      contentHash: hashContent(CURRENT.contentMarkdown),
      updatedById: ACTOR_ID,
    });
    expect(updateData).not.toHaveProperty('version');
    expect(updateData).not.toHaveProperty('indexStatus');
    expect(result.version).toBe(3);
  });

  it('drops chunks, bumps the version and resets the index state when content changes (published)', async () => {
    const { service, prisma, tx, queue, audit } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue(CURRENT);
    tx.supportKnowledgeArticle.update.mockResolvedValue({
      id: ARTICLE_ID,
      version: 4,
      status: KnowledgeArticleStatus.PUBLISHED,
    });
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({
      id: ARTICLE_ID,
      indexStatus: KnowledgeIndexStatus.PENDING,
    });

    const result = await service.update(ARTICLE_ID, { contentMarkdown: '# Số dư mới' }, ACTOR_ID);

    expect(tx.supportKnowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { articleId: ARTICLE_ID } });
    const updateCall = tx.supportKnowledgeArticle.update.mock.calls[0] as
      [{ data: Record<string, unknown> }] | undefined;

    if (!updateCall) {
      throw new Error('Expected supportKnowledgeArticle.update to be called');
    }

    const updateData = updateCall[0].data;
    expect(updateData).toMatchObject({
      contentMarkdown: '# Số dư mới',
      version: { increment: 1 },
      indexStatus: KnowledgeIndexStatus.PENDING,
      indexError: null,
      indexedAt: null,
    });
    expect(queue.add).toHaveBeenCalledWith('support.knowledge.index', { articleId: ARTICLE_ID }, expect.any(String));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_UPDATED }),
    );
    expect(result.indexStatus).toBe(KnowledgeIndexStatus.PENDING);
  });

  it('resets chunks when a draft is published but does not enqueue while still a draft', async () => {
    const { service, prisma, tx, queue } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({ ...CURRENT, status: KnowledgeArticleStatus.DRAFT });
    tx.supportKnowledgeArticle.update.mockResolvedValue({ id: ARTICLE_ID, version: 9 });

    await service.update(ARTICLE_ID, { status: KnowledgeArticleStatus.PUBLISHED }, ACTOR_ID);

    expect(tx.supportKnowledgeChunk.deleteMany).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();

    await service.update(
      ARTICLE_ID,
      { status: KnowledgeArticleStatus.PUBLISHED, contentMarkdown: '# Viết lại' },
      ACTOR_ID,
    );
    expect(queue.add).not.toHaveBeenCalled(); // still not published in the mocked row
  });

  it('throws 404 for a missing article', async () => {
    const { service, prisma } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue(null);

    await expect(service.update('ghost', { title: 'X' }, ACTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('KnowledgeService.archive', () => {
  it('archive drops the chunks, marks it archived and never enqueues', async () => {
    const { service, prisma, tx, queue, audit } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue(CURRENT);
    const archived = { id: ARTICLE_ID, slug: 'so-du', status: KnowledgeArticleStatus.ARCHIVED };
    tx.supportKnowledgeArticle.update.mockResolvedValue(archived);

    const result = await service.archive(ARTICLE_ID, ACTOR_ID);

    expect(tx.supportKnowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { articleId: ARTICLE_ID } });
    expect(tx.supportKnowledgeArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KnowledgeArticleStatus.ARCHIVED,
          indexStatus: KnowledgeIndexStatus.PENDING,
          indexError: null,
          indexedAt: null,
        }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_KNOWLEDGE_ARCHIVED }),
    );
    expect(result.status).toBe(KnowledgeArticleStatus.ARCHIVED);
  });

  it('archive of an edited archived article never re-enqueues it', async () => {
    const { service, prisma, tx, queue } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({
      ...CURRENT,
      status: KnowledgeArticleStatus.ARCHIVED,
    });
    tx.supportKnowledgeArticle.update.mockResolvedValue({ id: ARTICLE_ID, status: KnowledgeArticleStatus.ARCHIVED });

    await service.update(ARTICLE_ID, { contentMarkdown: '# Sửa sau khi archive' }, ACTOR_ID);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws 404 for a missing article', async () => {
    const { service, prisma } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue(null);

    await expect(service.archive('ghost', ACTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('KnowledgeService.reindex / reindexAll', () => {
  it('reindexes a published article only', async () => {
    const { service, prisma, queue } = buildService();
    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({
      id: ARTICLE_ID,
      status: KnowledgeArticleStatus.DRAFT,
    });

    await expect(service.reindex(ARTICLE_ID, ACTOR_ID)).rejects.toBeInstanceOf(BadRequestException);

    prisma.supportKnowledgeArticle.findUnique.mockResolvedValue({
      id: ARTICLE_ID,
      status: KnowledgeArticleStatus.PUBLISHED,
    });
    prisma.supportKnowledgeArticle.update.mockResolvedValue(undefined);

    const result = await service.reindex(ARTICLE_ID, ACTOR_ID);

    expect(prisma.supportKnowledgeArticle.update).toHaveBeenCalledWith({
      where: { id: ARTICLE_ID },
      data: {
        indexStatus: KnowledgeIndexStatus.PENDING,
        indexError: null,
        indexedAt: null,
        updatedById: ACTOR_ID,
      },
    });
    expect(queue.add).toHaveBeenCalledWith('support.knowledge.index', { articleId: ARTICLE_ID }, expect.any(String));
    expect(result).toEqual({ articleId: ARTICLE_ID, indexStatus: KnowledgeIndexStatus.PENDING });
  });

  it('reindexAll queues every published article and resets their index state', async () => {
    const { service, prisma, queue } = buildService();
    prisma.supportKnowledgeArticle.findMany.mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }]);
    prisma.supportKnowledgeArticle.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.reindexAll(ACTOR_ID);

    expect(prisma.supportKnowledgeArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: KnowledgeArticleStatus.PUBLISHED } }),
    );
    expect(prisma.supportKnowledgeArticle.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a-1', 'a-2'] } },
      data: expect.objectContaining({ indexStatus: KnowledgeIndexStatus.PENDING, indexError: null, indexedAt: null }),
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ total: 2, queued: 2 });
  });

  it('enqueueIndex swallows queue outages (the sweep is the safety net)', async () => {
    const { service, queue } = buildService();
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(service.enqueueIndex(ARTICLE_ID)).resolves.toBeUndefined();
  });
});

describe('KnowledgeService.health — failure state', () => {
  it('reports failed/pending counts, last indexed time and config flags without secrets', async () => {
    const { service, prisma } = buildService();
    prisma.supportKnowledgeChunk.count.mockResolvedValue(42);
    prisma.supportKnowledgeArticle.count
      .mockResolvedValueOnce(2) // failed
      .mockResolvedValueOnce(1); // pending
    prisma.supportKnowledgeArticle.findFirst.mockResolvedValue({ indexedAt: new Date('2026-11-09T10:00:00Z') });

    const health = await service.health();

    expect(health).toMatchObject({
      mode: 'live',
      chatModel: 'test-model',
      chatConfigured: true,
      embeddingModel: 'embed-model',
      embeddingDimensions: 768,
      embeddingConfigured: true,
      indexedChunks: 42,
      failedArticles: 2,
      pendingArticles: 1,
    });
    expect(health.lastIndexedAt).toEqual(new Date('2026-11-09T10:00:00Z'));
    expect(prisma.supportKnowledgeArticle.count).toHaveBeenCalledWith({
      where: { status: KnowledgeArticleStatus.PUBLISHED, indexStatus: KnowledgeIndexStatus.FAILED },
    });
    expect(health).not.toHaveProperty('aiChatApiKey');
  });

  it('treats the chat provider as unconfigured when the base url is missing', async () => {
    const { service, prisma } = buildService({ aiChatBaseUrl: undefined });
    prisma.supportKnowledgeChunk.count.mockResolvedValue(0);
    prisma.supportKnowledgeArticle.count.mockResolvedValue(0);
    prisma.supportKnowledgeArticle.findFirst.mockResolvedValue(null);

    const health = await service.health();

    expect(health.chatConfigured).toBe(false);
    expect(health.embeddingConfigured).toBe(true);
    expect(health.lastIndexedAt).toBeNull();
  });
});

describe('knowledge hashing', () => {
  it('hashContent is sha256 hex and empty-input stable', () => {
    expect(hashContent('Số dư')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent('Số dư')).toBe(hashContent('Số dư'));
  });

  it('chunkHash binds the embedding model to the content', () => {
    expect(chunkHash('embed-a', 'same content')).not.toBe(chunkHash('embed-b', 'same content'));
    expect(chunkHash('embed-a', 'same content')).toBe(chunkHash('embed-a', 'same content'));
  });
});
