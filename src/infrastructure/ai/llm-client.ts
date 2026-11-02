/**
 * Provider-neutral AI contracts (plan §5.1). The support module never imports a vendor SDK:
 * a provider is one small fetch-based class behind these interfaces, chosen by APP_CONFIG.
 */

export interface ChatToolDefinition {
  name: string;
  description: string;
  /** JSON schema of the arguments, OpenAI function-calling shape. */
  parameters: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  /** Raw JSON string the model produced for the arguments. */
  arguments: string;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on a `tool` message: the call it answers. */
  toolCallId?: string;
  /** Set on an `assistant` message that asked for tools. */
  toolCalls?: ChatToolCall[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ChatToolCall[];
  model: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatClient {
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface EmbeddingClient {
  readonly model: string;
  /** Optional provider revision stored on each chunk. */
  readonly modelVersion?: string;
  readonly dimensions: number;
  /** One vector per input, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}

export const CHAT_CLIENT = Symbol('CHAT_CLIENT');
export const EMBEDDING_CLIENT = Symbol('EMBEDDING_CLIENT');
