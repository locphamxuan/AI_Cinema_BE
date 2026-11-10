import type { EmbeddingClient } from './llm-client';

export interface OpenAiCompatibleEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

/** Gemini's OpenAI-compatible endpoint accepts at most 100 inputs per batch. */
const BATCH_SIZE = 32;

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
}

/**
 * `POST {baseUrl}/embeddings` against any OpenAI-compatible provider (Gemini, OpenAI, Ollama).
 * The response order is not trusted: `index` decides where each vector belongs.
 */
export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly options: OpenAiCompatibleEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    if (!this.options.baseUrl) throw new Error('AI_EMBEDDING_BASE_URL is not configured');
    if (!this.options.apiKey) throw new Error('AI_EMBEDDING_API_KEY is not configured');

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        input: batch,
        // The vector column is fixed-width; ask the provider for that exact size (Gemini
        // `gemini-embedding-001` otherwise returns 3072).
        dimensions: this.options.dimensions,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    const body = (await response.json().catch(() => ({}))) as EmbeddingResponse;
    if (!response.ok) {
      throw new Error(`Embedding provider answered ${response.status}: ${body.error?.message ?? 'no detail'}`);
    }
    if (!body.data?.length) throw new Error('Embedding provider returned no vectors');

    const ordered = new Array<number[]>(batch.length);
    body.data.forEach((item, position) => {
      const index = item.index ?? position;
      if (!item.embedding || index < 0 || index >= ordered.length) return;
      if (item.embedding.length !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: ${this.options.model} returned ${item.embedding.length}, the vector column holds ${this.dimensions}`,
        );
      }
      ordered[index] = item.embedding;
    });

    if (ordered.some((vector) => !vector)) throw new Error('Embedding provider skipped an input');
    return ordered;
  }
}
