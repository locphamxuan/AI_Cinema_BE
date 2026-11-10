import { RAG_EVAL_SET, SEEDED_ARTICLE_SLUGS, type EvalExpectation } from './rag-eval-set';

/**
 * Dataset integrity, not evaluation results: keeps the §5.3 labels honest (every case has a
 * behavior to measure, every expected article exists in the seed). The runners that score the
 * set against a live retrieval/agent come later (TODO §5.3 #2).
 */
describe('RAG eval dataset integrity', () => {
  it('holds 30–50 cases with unique ids', () => {
    expect(RAG_EVAL_SET.length).toBeGreaterThanOrEqual(30);
    expect(RAG_EVAL_SET.length).toBeLessThanOrEqual(50);
    expect(new Set(RAG_EVAL_SET.map((entry) => entry.id)).size).toBe(RAG_EVAL_SET.length);
    expect(RAG_EVAL_SET.every((entry) => entry.question.trim().length > 0)).toBe(true);
  });

  it('covers each behavior with at least three cases', () => {
    const counts = RAG_EVAL_SET.reduce<Record<EvalExpectation, number>>(
      (accumulator, entry) => {
        accumulator[entry.expect] += 1;
        return accumulator;
      },
      { answer: 0, tool: 0, escalate: 0, refuse: 0 },
    );
    for (const label of Object.keys(counts) as EvalExpectation[]) expect(counts[label]).toBeGreaterThanOrEqual(3);
  });

  it('covers every seeded knowledge article for answer cases', () => {
    const covered = new Set(
      RAG_EVAL_SET.filter((entry) => entry.expect === 'answer').flatMap((entry) => entry.expectedSlugs),
    );
    for (const slug of SEEDED_ARTICLE_SLUGS) expect(covered.has(slug)).toBe(true);
  });

  it('only references articles that exist in the seed', () => {
    for (const entry of RAG_EVAL_SET) {
      for (const slug of entry.expectedSlugs) expect(SEEDED_ARTICLE_SLUGS).toContain(slug);
    }
  });

  it('keeps answer cases for hit@k and tool cases for tool-calling', () => {
    for (const entry of RAG_EVAL_SET) {
      if (entry.expect === 'answer') {
        expect(entry.expectedSlugs.length).toBeGreaterThan(0);
        expect(entry.expectedTools).toBeUndefined();
      }
      if (entry.expect === 'tool') {
        expect(entry.expectedSlugs).toEqual([]);
        expect(entry.expectedTools?.length).toBeGreaterThan(0);
      }
      if (entry.expect === 'escalate' || entry.expect === 'refuse') {
        expect(entry.expectedSlugs).toEqual([]);
        expect(entry.expectedTools).toBeUndefined();
      }
    }
  });
});
