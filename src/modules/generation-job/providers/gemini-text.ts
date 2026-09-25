import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import { callProviderJson } from './http';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Helper calls sit in front of a generation; they must never hold it up for long.
const TIMEOUT_MS = 20_000;

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export interface GeminiTextRequest {
  system: string;
  prompt: string;
  /** Asks for a JSON answer (response_mime_type application/json). */
  json?: boolean;
}

/**
 * Short helper calls to the free Gemini text model (Prompt Composer, scene advisor).
 * `isAvailable` is false outside AI_PROVIDER_MODE=live or without a key; callers then
 * use their offline fallback.
 */
@Injectable()
export class GeminiTextClient {
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    const live = config.get<string>('AI_PROVIDER_MODE') === 'live';
    this.apiKey = live ? config.get<string>('GEMINI_API_KEY')?.trim() || undefined : undefined;
  }

  get isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  get model(): string {
    return AI_MODEL_CATALOG.llm.name;
  }

  async generate({ system, prompt, json }: GeminiTextRequest): Promise<string> {
    if (!this.apiKey) throw new Error('Gemini is not configured');
    const response = await callProviderJson<GenerateContentResponse>(
      'Gemini',
      `${API}/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, ...(json && { responseMimeType: 'application/json' }) },
        }),
      },
      TIMEOUT_MS,
    );
    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim() ?? '';
    if (!text) throw new Error('Gemini returned an empty answer');
    return text;
  }
}
