/**
 * Seeds the Vietnamese support FAQ (plan §4.1) and, when an embedding provider is configured,
 * indexes it immediately. Idempotent by (slug, locale): re-running updates the text and rebuilds
 * the chunks. Run with `npm run seed:support-knowledge`.
 *
 * Dynamic values (Coin rate, balances, transaction states) are deliberately absent: the AI reads
 * them through tools so a seeded article can never go stale.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { KnowledgeArticleStatus, KnowledgeIndexStatus, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { HashingEmbeddingClient } from '../src/infrastructure/ai/hashing-embedding.client';
import { OpenAiCompatibleEmbeddingClient } from '../src/infrastructure/ai/openai-compatible-embedding.client';
import type { EmbeddingClient } from '../src/infrastructure/ai/llm-client';
import { ChunkingService } from '../src/modules/support/knowledge/chunking.service';
import { SEED_ARTICLES } from './knowledge-seed-data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const chunking = new ChunkingService();

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function chunkHash(model: string, content: string): string {
  return sha256(`${model}\u0000${content}`);
}

function embeddingClient(): EmbeddingClient | null {
  const mode = process.env.AI_MODE ?? 'live';
  const dimensions = Number(process.env.AI_EMBEDDING_DIMENSIONS ?? 768);
  if (mode === 'disabled') return null;
  if (mode === 'mock') return new HashingEmbeddingClient(dimensions);

  const baseUrl = process.env.AI_EMBEDDING_BASE_URL ?? process.env.AI_CHAT_BASE_URL;
  const apiKey = process.env.AI_EMBEDDING_API_KEY ?? process.env.AI_CHAT_API_KEY;
  if (!baseUrl || !apiKey) return null;

  return new OpenAiCompatibleEmbeddingClient({
    baseUrl,
    apiKey,
    model: process.env.AI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    dimensions,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30_000),
  });
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const embeddings = embeddingClient();
  let indexed = 0;
  let pending = 0;

  for (const article of SEED_ARTICLES) {
    const contentHash = sha256(article.markdown);
    const shared = {
      title: article.title,
      category: article.category,
      audience: article.audience,
      locale: 'vi',
      contentMarkdown: article.markdown,
      status: KnowledgeArticleStatus.PUBLISHED,
      source: article.source,
      contentHash,
      indexStatus: KnowledgeIndexStatus.PENDING,
      indexError: null,
      indexedAt: null,
      ...(admin ? { createdById: admin.id, updatedById: admin.id } : {}),
    };

    const row = await prisma.supportKnowledgeArticle.upsert({
      where: { slug_locale: { slug: article.slug, locale: 'vi' } },
      update: shared,
      create: { ...shared, slug: article.slug },
      select: { id: true },
    });
    await prisma.supportKnowledgeChunk.deleteMany({ where: { articleId: row.id } });

    if (!embeddings) {
      pending += 1;
      continue;
    }

    try {
      const chunks = chunking.chunk(article.markdown, article.title);
      const vectors = await embeddings.embed(chunks.map((chunk) => chunk.content));
      if (vectors.length !== chunks.length) throw new Error('Embedding provider returned the wrong count');

      await prisma.$transaction(async (tx) => {
        if (chunks.length) {
          const rows = chunks.map(
            (chunk, index) =>
              Prisma.sql`(
              ${randomUUID()}::uuid, ${row.id}::uuid, ${chunk.chunkIndex}, ${chunk.heading},
              ${chunk.content}, ${chunk.tokenCount}, ${vectorLiteral(vectors[index])}::vector,
              ${embeddings.model}, ${embeddings.modelVersion ?? null}, ${chunkHash(embeddings.model, chunk.content)}
            )`,
          );
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "support_knowledge_chunks"
              ("id", "article_id", "chunk_index", "heading", "content", "token_count",
               "embedding", "embedding_model", "embedding_model_version", "content_hash")
            VALUES ${Prisma.join(rows)}
          `);
        }
        await tx.supportKnowledgeArticle.update({
          where: { id: row.id },
          data: { indexStatus: KnowledgeIndexStatus.INDEXED, indexedAt: new Date(), indexError: null },
        });
      });
      indexed += 1;
    } catch (error) {
      pending += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
      await prisma.supportKnowledgeArticle.update({
        where: { id: row.id },
        data: { indexStatus: KnowledgeIndexStatus.FAILED, indexError: message },
      });
      console.warn(`Seed: article ${article.slug} left unindexed: ${message}`);
    }
  }

  console.log(
    `Support knowledge: ${SEED_ARTICLES.length} articles, ${indexed} indexed${pending ? `, ${pending} left for the index job` : ''}.`,
  );
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
