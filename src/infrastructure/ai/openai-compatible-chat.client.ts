import { SupportAiUnavailableError } from './ai-errors';
import type { ChatClient, ChatMessage, ChatRequest, ChatResult, ChatToolCall, ChatToolDefinition } from './llm-client';

export interface OpenAiCompatibleChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
  /** Extra attempts after the first one for 429, 5xx and network failures. */
  maxRetries?: number;
  /** First retry wait; each later attempt doubles it. */
  retryBaseDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

type OpenAiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; content: string; tool_call_id?: string };

interface OpenAiResponseBody {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string | Record<string, unknown> };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * `POST {baseUrl}/chat/completions` against any OpenAI-compatible provider (OpenAI, Gemini,
 * DeepSeek, OpenRouter, Ollama). Provider failures become `SupportAiUnavailableError` so the
 * support chat escalates instead of returning a half answer. Nothing here logs prompts,
 * completions or the API key.
 */
export class OpenAiCompatibleChatClient implements ChatClient {
  readonly model: string;

  private readonly endpoint: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(private readonly options: OpenAiCompatibleChatOptions) {
    this.model = options.model;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.maxRetries = Math.max(options.maxRetries ?? DEFAULT_MAX_RETRIES, 0);
    this.retryBaseDelayMs = Math.max(options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 0);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (!this.options.baseUrl) {
      throw new SupportAiUnavailableError('NOT_CONFIGURED', 'AI_CHAT_BASE_URL is not configured');
    }
    if (!this.options.apiKey) {
      throw new SupportAiUnavailableError('NOT_CONFIGURED', 'AI_CHAT_API_KEY is not configured');
    }

    const body = await this.post(this.payload(request), request.timeoutMs ?? this.options.timeoutMs);
    return this.parse(body);
  }

  private payload(request: ChatRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: request.messages.map((message) => this.mapMessage(message)),
      ...(request.tools?.length ? { tools: request.tools.map(toOpenAiTool) } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      temperature: request.temperature ?? this.options.temperature,
      max_tokens: request.maxOutputTokens ?? this.options.maxOutputTokens,
    };
  }

  private mapMessage(message: ChatMessage): OpenAiMessage {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map(toOpenAiToolCall),
      };
    }
    return { role: message.role, content: message.content };
  }

  /** 429 and 5xx are retried with exponential backoff; `Retry-After` wins when present. */
  private async post(payload: Record<string, unknown>, timeoutMs: number): Promise<OpenAiResponseBody> {
    const attempts = this.maxRetries + 1;
    let delayMs = 0;
    let lastFailure = 'no response';

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(delayMs);

      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastFailure = describeNetworkError(error);
        if (attempt + 1 < attempts) {
          delayMs = this.backoffMs(attempt + 1);
          continue;
        }
        break;
      }

      const body = await readBody(response);
      if (response.ok) return body;

      lastFailure = `HTTP ${response.status}${providerDetail(body)}`;
      if (!isRetryableStatus(response.status) || attempt + 1 >= attempts) break;

      delayMs = retryAfterMs(response) ?? this.backoffMs(attempt + 1);
    }

    throw new SupportAiUnavailableError(
      'PROVIDER_ERROR',
      `Chat provider request failed after ${attempts} attempt(s): ${lastFailure}`,
    );
  }

  private parse(body: OpenAiResponseBody): ChatResult {
    const choice = body.choices?.[0];
    if (!choice) {
      throw new SupportAiUnavailableError('PROVIDER_ERROR', 'Chat provider returned no choices');
    }

    const message = choice.message ?? {};
    const toolCalls: ChatToolCall[] = [];
    for (const [index, call] of (message.tool_calls ?? []).entries()) {
      const name = call.function?.name;
      if (!name) continue;
      const args = call.function?.arguments;
      toolCalls.push({
        id: call.id || `tool_call_${index}`,
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      });
    }

    return {
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      model: body.model || this.model,
      finishReason: choice.finish_reason,
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    };
  }

  private backoffMs(attempt: number): number {
    return Math.min(this.retryBaseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  }
}

function toOpenAiTool(tool: ChatToolDefinition): OpenAiTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function toOpenAiToolCall(call: ChatToolCall): OpenAiToolCall {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readBody(response: Response): Promise<OpenAiResponseBody> {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text) as OpenAiResponseBody;
  } catch {
    return {};
  }
}

/** The provider's own message is safe to keep; prompts and API keys are never included. */
function providerDetail(body: OpenAiResponseBody): string {
  const message = body.error?.message?.trim();
  return message ? `: ${message.slice(0, 200)}` : '';
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

/** Only the error class/code, never a request body, ends up in the message. */
function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'network error';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  const code = (error.cause as { code?: string } | undefined)?.code;
  return code ? `network error (${code})` : `network error (${error.name})`;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
