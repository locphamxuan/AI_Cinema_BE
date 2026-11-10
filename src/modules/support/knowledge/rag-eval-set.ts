/**
 * RAG evaluation dataset: 40 Vietnamese member questions with expected
 * retrieval targets and expected assistant behavior, used by the eval runner to measure
 * hit@k (answer cases), tool-calling (tool cases), escalation precision/recall (escalate cases)
 * and guardrail behavior (refuse cases).
 *
 * Slugs below are the ids of the 10 seeded FAQ articles in prisma/seed-support-knowledge.ts.
 * Article content intentionally ships no dynamic values: figures a question asks about must come
 * from tools so the dataset stays true as policies change.
 */

export type EvalExpectation = 'answer' | 'tool' | 'escalate' | 'refuse';

export interface RagEvalCase {
  id: string;
  question: string;
  expect: EvalExpectation;
  /** KB articles the retrieval is expected to find (hit@k measurement, answer cases only). */
  expectedSlugs: string[];
  /** Tools the agent is expected to call (Live agent evaluation, tool cases only). */
  expectedTools?: string[];
  /** Loose substrings the final reply should include (groundedness sanity, Live only). */
  expectedReplyContains?: string[];
  notes: string;
}

import { SEED_ARTICLES } from '../../../../prisma/knowledge-seed-data';

/** Slugs of the seeded FAQ subjects (single source of truth: prisma/knowledge-seed-data.ts). */
export const SEEDED_ARTICLE_SLUGS = SEED_ARTICLES.map((article) => article.slug);

import { RAG_EVAL_ANSWER_CASES } from './rag-eval-answer-cases';
import { RAG_EVAL_ESCALATION_CASES } from './rag-eval-escalation-cases';

export const RAG_EVAL_SET: RagEvalCase[] = [...RAG_EVAL_ANSWER_CASES, ...RAG_EVAL_ESCALATION_CASES];
