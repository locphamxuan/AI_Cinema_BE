import type { EmbeddingClient } from './llm-client';

/**
 * Deterministic offline embedding (feature hashing) for AI_MODE=mock, tests and seeded demos
 * without an API key. Exact words land in the same buckets, so a query still finds a chunk that
 * repeats them; it is not a substitute for a real model in production.
 */
export class HashingEmbeddingClient implements EmbeddingClient {
  readonly model = 'mock-hash-embedding';
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.vector(text)));
  }

  private vector(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1);

    for (const token of tokens) {
      const bucket = fnv1a(token) % this.dimensions;
      const sign = (fnv1a(`${token}\u0001`) & 1) === 0 ? 1 : -1;
      vector[bucket] += sign;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm > 0 ? vector.map((value) => value / norm) : vector;
  }
}

/** 32-bit FNV-1a; stable across processes, unlike a salted hash. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
