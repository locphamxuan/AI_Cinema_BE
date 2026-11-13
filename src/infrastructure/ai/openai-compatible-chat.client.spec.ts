import { SupportAiUnavailableError } from './ai-errors';
import { OpenAiCompatibleChatClient, type OpenAiCompatibleChatOptions } from './openai-compatible-chat.client';

const baseOptions: OpenAiCompatibleChatOptions = {
  baseUrl: 'https://llm.example/v1/',
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 1000,
  temperature: 0.2,
  maxOutputTokens: 256,
  retryBaseDelayMs: 0,
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function requestBody(fetchMock: jest.SpyInstance, callIndex = 0): Record<string, unknown> {
  const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  if (typeof call[1].body !== 'string') throw new Error('Expected a JSON string body');
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

describe('OpenAiCompatibleChatClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends messages, tools and generation settings to /chat/completions', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'test-model-2026',
        choices: [{ message: { role: 'assistant', content: 'Xin chào' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    );
    const client = new OpenAiCompatibleChatClient(baseOptions);

    const result = await client.chat({
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hello' },
      ],
      tools: [
        {
          name: 'get_member_wallet',
          description: 'wallet',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      toolChoice: 'auto',
      temperature: 0.1,
      maxOutputTokens: 128,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://llm.example/v1/chat/completions');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(requestBody(fetchMock)).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hello' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_member_wallet',
            description: 'wallet',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
      tool_choice: 'auto',
      temperature: 0.1,
      max_tokens: 128,
    });
    expect(result).toEqual({
      content: 'Xin chào',
      toolCalls: [],
      model: 'test-model-2026',
      finishReason: 'stop',
      promptTokens: 12,
      completionTokens: 5,
    });
  });

  it('parses tool calls and forwards assistant/tool messages in the OpenAI shape', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'test-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'get_member_wallet', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
    const client = new OpenAiCompatibleChatClient(baseOptions);

    const result = await client.chat({
      messages: [
        { role: 'user', content: 'Số dư của tôi?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'get_member_wallet', arguments: '{}' }],
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1' },
      ],
    });

    expect(requestBody(fetchMock).messages).toEqual([
      { role: 'user', content: 'Số dư của tôi?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_member_wallet', arguments: '{}' } }],
      },
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1' },
    ]);
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'get_member_wallet', arguments: '{}' }]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('retries 429 and 5xx responses before returning the answer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'temporary' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    const client = new OpenAiCompatibleChatClient({ ...baseOptions, retryBaseDelayMs: 0 });

    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.content).toBe('ok');
  });

  it('does not retry 4xx and throws a typed provider error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, 401));
    const client = new OpenAiCompatibleChatClient(baseOptions);

    const request = client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    await expect(request).rejects.toBeInstanceOf(SupportAiUnavailableError);
    await expect(request).rejects.toMatchObject({ cause: 'PROVIDER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the retry budget is exhausted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'down' } }, 503));
    const client = new OpenAiCompatibleChatClient({ ...baseOptions, maxRetries: 1, retryBaseDelayMs: 0 });

    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      cause: 'PROVIDER_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps network failures as a typed provider error', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const client = new OpenAiCompatibleChatClient({ ...baseOptions, maxRetries: 0 });

    const request = client.chat({ messages: [{ role: 'user', content: 'hi' }] });

    await expect(request).rejects.toMatchObject({ cause: 'PROVIDER_ERROR' });
    await expect(request).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects a provider response without choices', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    const client = new OpenAiCompatibleChatClient(baseOptions);

    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      cause: 'PROVIDER_ERROR',
    });
  });

  it('refuses to call a provider without an API key', async () => {
    const client = new OpenAiCompatibleChatClient({ ...baseOptions, apiKey: '' });

    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      cause: 'NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
