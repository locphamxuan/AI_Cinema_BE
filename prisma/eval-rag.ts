/**
 * RAG evaluation runner (TODO §5.3): hit@k, predicted-escalation precision/recall on the 40
 * Vietnamese cases in src/modules/support/knowledge/rag-eval-set.ts, against the REAL pgvector
 * retrieval (same SQL as production; mock hashed embeddings because the live embedding model
 * is not configured in this environment).
 *
 *   npm run eval:rag          # TopK=6, minScore=0.35 (production defaults)
 *   npm run eval:rag -- --topk 3 --minscore 0.5
 *
 * Requires: the seeded KB to be INDEXED (npm run seed:support-knowledge with AI_MODE=mock).
 * A live embedding model re-embeds all chunks (reindexAll) before --live can report anything,
 * because retrieval filters on embedding_model; groundedness and tool-calling metrics need the
 * LLM provider and are intentionally out of this runner.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../src/config/app-config';
import { HashingEmbeddingClient } from '../src/infrastructure/ai/hashing-embedding.client';
import { RetrievalService } from '../src/modules/support/knowledge/retrieval.service';
import { RAG_EVAL_SET, type EvalExpectation } from '../src/modules/support/knowledge/rag-eval-set';

interface Args {
  topK: number;
  minScore: number;
  debug: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { topK: 6, minScore: 0.35, debug: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--topk') args.topK = Number(argv[++i]);
    if (argv[i] === '--minscore') args.minScore = Number(argv[++i]);
    if (argv[i] === '--debug') args.debug = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  const slugById = new Map<string, string>();
  for (const row of await prisma.supportKnowledgeArticle.findMany({ select: { id: true, slug: true } })) {
    slugById.set(row.id, row.slug);
  }
  if (!slugById.size) {
    console.error('KB is empty — run: npm run seed:support-knowledge (AI_MODE=mock) before this runner.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const config = {
    support: {
      aiMode: 'mock',
      ragTopK: args.topK,
      ragMinScore: args.minScore,
      aiEmbeddingDimensions: 768,
    },
  } as unknown as AppConfig;

  const embeddings = new HashingEmbeddingClient(768);
  const retrieval = new RetrievalService(prisma as never, config, embeddings);

  const rows: Array<{
    id: string;
    expect: EvalExpectation;
    expectedSlugs: string[];
    retrievedSlugs: string[];
    topScore: number;
    predicted: 'answer' | 'escalate';
  }> = [];

  for (const entry of RAG_EVAL_SET) {
    const chunks = await retrieval.retrieve(entry.question, {
      audience: 'MEMBER',
      locale: 'vi',
      topK: args.topK,
      minScore: args.minScore,
    });
    const retrievedSlugs = [...new Set(chunks.map((chunk) => slugById.get(chunk.articleId) ?? '?'))];
    const topScore = chunks[0]?.score ?? 0;
    rows.push({
      id: entry.id,
      expect: entry.expect,
      expectedSlugs: entry.expectedSlugs,
      retrievedSlugs,
      topScore,
      predicted: chunks.length ? 'answer' : 'escalate',
    });
  }

  const answers = rows.filter((row) => row.expect === 'answer');
  const answerHit = (k: number) =>
    answers.filter((row) => row.expectedSlugs.some((slug) => row.retrievedSlugs.slice(0, k).includes(slug))).length /
    answers.length;
  const escalates = rows.filter((row) => row.expect === 'escalate' || row.expect === 'refuse');
  const shouldAnswer = rows.filter((row) => row.expect === 'answer' || row.expect === 'tool');

  const tp = escalates.filter((row) => row.predicted === 'escalate').length;
  const fp = shouldAnswer.filter((row) => row.predicted === 'escalate').length;
  const fn = escalates.filter((row) => row.predicted === 'answer').length;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp / escalates.length;

  const label = (value: number) => (value * 100).toFixed(1);

  console.log('\nRAG EVAL — mock-hash embedding, real pgvector retrieval');
  console.log(
    `cases: ${rows.length} (answer=${answers.length}, escalate+refuse=${escalates.length}) · topK=${args.topK} · minScore=${args.minScore}`,
  );
  console.log(
    `hit@1  = ${label(answerHit(1))}%  (${answers.filter((r) => r.expectedSlugs.some((s) => r.retrievedSlugs[0] === s)).length}/${answers.length})`,
  );
  console.log(
    `hit@3  = ${label(answerHit(3))}%  (${answers.filter((r) => r.expectedSlugs.some((s) => r.retrievedSlugs.slice(0, 3).includes(s))).length}/${answers.length})`,
  );
  console.log(
    `hit@${args.topK}  = ${label(answerHit(args.topK))}%  (${answers.filter((r) => r.expectedSlugs.some((s) => r.retrievedSlugs.slice(0, args.topK).includes(s))).length}/${answers.length})`,
  );
  console.log(`predicted-escalate precision = ${label(precision)}% (tp=${tp}, fp=${fp})`);
  console.log(`predicted-escalate recall    = ${label(recall)}% (tp=${tp}, fn=${fn})`);

  const missLine = (row: (typeof rows)[number]) =>
    `  ${row.id} expect=${row.expect} topScore=${row.topScore.toFixed(2)} retrieved=${JSON.stringify(row.retrievedSlugs)} expected=${JSON.stringify(row.expectedSlugs)}`;

  const misses = answers.filter((row) => !row.expectedSlugs.some((slug) => row.retrievedSlugs.includes(slug)));
  if (misses.length) {
    console.log(`\nanswer misses (${misses.length}):`);
    misses.forEach((row) => console.log(missLine(row)));
  }
  const falseEscalates = shouldAnswer.filter((row) => row.predicted === 'escalate');
  if (falseEscalates.length) {
    console.log(`\nfalse escalates on answer/tool cases (${falseEscalates.length}):`);
    falseEscalates.forEach((row) => console.log(missLine(row)));
  }
  const missedEscalates = escalates.filter((row) => row.predicted === 'answer');
  if (missedEscalates.length) {
    console.log(`\nescalate cases the retrieval would have answered (${missedEscalates.length}):`);
    missedEscalates.forEach((row) => console.log(missLine(row)));
  }

  console.log(
    '\ngroundedness + tool-calling metrics require a live LLM provider (groundedness judge) — see note in runner header.',
  );

  if (args.debug) {
    console.log('\nDEBUG: re-running answer misses with minScore=0 to see raw scores (tune minScore/chunking impact):');
    for (const row of rows.filter((r) => r.expect === 'answer' && !r.retrievedSlugs.length)) {
      const raw = await retrieval.retrieve(RAG_EVAL_SET.find((e) => e.id === row.id)?.question ?? '', {
        audience: 'MEMBER',
        locale: 'vi',
        topK: args.topK,
        minScore: 0,
      });
      console.log(
        `  ${row.id} rawTopScore=${raw[0]?.score.toFixed(3) ?? 'none'} rawRetrieved=${JSON.stringify([...new Set(raw.map((c) => slugById.get(c.articleId) ?? '?'))])}`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
