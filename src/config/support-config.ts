import type { EnvReader } from './env-reader';

/**
 * AI customer support settings. The AI provider is optional on purpose: with no key the chat
 * client is never built, the assistant reports itself unavailable and every case goes straight
 * to the Staff inbox instead of the API failing to boot.
 */
export interface SupportConfig {
  aiMode: 'live' | 'mock' | 'disabled';
  aiChatBaseUrl?: string;
  aiChatApiKey?: string;
  aiChatModel: string;
  aiEmbeddingBaseUrl?: string;
  aiEmbeddingApiKey?: string;
  aiEmbeddingModel: string;
  /** Must match the `vector(N)` column in the migration (768 for gemini-embedding-001 with dimensions=768). */
  aiEmbeddingDimensions: number;
  aiTimeoutMs: number;
  aiMaxOutputTokens: number;
  aiTemperature: number;
  aiMaxToolRounds: number;
  aiHistoryMessages: number;
  ragTopK: number;
  ragMinScore: number;
  autoCloseHours: number;
  autoCloseSweepMs: number;
  dailyMessageLimit: number;
  messageMaxChars: number;
}

export function supportConfig(read: EnvReader): SupportConfig {
  return {
    aiMode: read.oneOf('AI_MODE', ['live', 'mock', 'disabled'] as const, 'live'),
    aiChatBaseUrl: read.optional('AI_CHAT_BASE_URL'),
    aiChatApiKey: read.optional('AI_CHAT_API_KEY'),
    aiChatModel: read.string('AI_CHAT_MODEL', 'gemini-3.1-flash-lite'),
    aiEmbeddingBaseUrl: read.optional('AI_EMBEDDING_BASE_URL'),
    aiEmbeddingApiKey: read.optional('AI_EMBEDDING_API_KEY'),
    aiEmbeddingModel: read.string('AI_EMBEDDING_MODEL', 'gemini-embedding-001'),
    aiEmbeddingDimensions: read.int('AI_EMBEDDING_DIMENSIONS', 768, 1),
    aiTimeoutMs: read.int('AI_TIMEOUT_MS', 30_000, 1000),
    aiMaxOutputTokens: read.int('AI_MAX_OUTPUT_TOKENS', 800, 1),
    aiTemperature: read.float('AI_TEMPERATURE', 0.2, 0),
    aiMaxToolRounds: read.int('AI_MAX_TOOL_ROUNDS', 4, 1),
    aiHistoryMessages: read.int('AI_HISTORY_MESSAGES', 20, 1),
    ragTopK: read.int('AI_RAG_TOP_K', 6, 1),
    ragMinScore: read.float('AI_RAG_MIN_SCORE', 0.35, 0),
    autoCloseHours: read.int('SUPPORT_AUTO_CLOSE_HOURS', 24, 1),
    autoCloseSweepMs: read.int('SUPPORT_AUTO_CLOSE_SWEEP_MS', 15 * 60_000),
    dailyMessageLimit: read.int('SUPPORT_DAILY_MESSAGE_LIMIT', 200, 1),
    messageMaxChars: read.int('SUPPORT_MESSAGE_MAX_CHARS', 4000, 1),
  };
}
