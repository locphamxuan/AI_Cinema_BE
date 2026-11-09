import {
  OpenAiCompatibleEmbeddingClient,
  type OpenAiCompatibleEmbeddingOptions,
} from './openai-compatible-embedding.client';

const baseOptions: OpenAiCompatibleEmbeddingOptions = {
  baseUrl: 'https://llm.example/v1/',
  apiKey: 'test-key',
  model: 'gemini-embedding-001',
  dimensions: 3,
  timeoutMs: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(fetchMock: jest.SpyInstance, callIndex = 0): Record<string, unknown> {
  const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  if (typeof call[1].body !== 'string') throw new Error('Expected a JSON string body');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

describe('OpenAiCompatibleEmbeddingClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks for the configured dimensions and orders vectors by index', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { index: 1, embedding: [4, 5, 6] },
          { index: 0, embedding: [1, 2, 3] },
        ],
      }),
    );
    const client = new OpenAiCompatibleEmbeddingClient(baseOptions);

    const vectors = await client.embed(['first', 'second']);

    expect(vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody(fetchMock)).toMatchObject({
      model: 'gemini-embedding-001',
      input: ['first', 'second'],
      dimensions: 3,
    });
  });

  it('rejects a vector whose size does not match the vector column', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: [1, 2, 3, 4] }] }));
    const client = new OpenAiCompatibleEmbeddingClient(baseOptions);

    await expect(client.embed(['text'])).rejects.toThrow('Embedding dimension mismatch');
  });

  it('surfaces the provider error message without the API key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'model not found' } }, 404));
    const client = new OpenAiCompatibleEmbeddingClient(baseOptions);

    await expect(client.embed(['text'])).rejects.toThrow('Embedding provider answered 404: model not found');
  });
});
