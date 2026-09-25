import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProviderJson } from './http';

interface ChatCompletion {
  choices: { message: { content: string | null } }[];
  usage?: { completion_tokens: number };
}

// One billing unit of text output = this many completion tokens (catalog baseUnits 10 ≈ 1000 tokens).
const TOKENS_PER_UNIT = 100;

const SCRIPT_SYSTEM_PROMPT =
  'You are the screenwriter of an AI-produced film. Follow the direction exactly and answer with the requested text only.';
const subtitleSystemPrompt = (language: string) =>
  `You write film subtitles. Turn the direction into the spoken line(s) of the scene in the language "${language}". ` +
  'Answer with the subtitle text only, no quotes, no timestamps.';

/** Script, synopsis and subtitle text through the OpenAI Chat Completions API. */
export class OpenAiTextProvider implements AiGenerationProvider {
  readonly name = 'openai';

  constructor(private readonly apiKey: string) {}

  async generate({ model, composedPrompt, language }: AiGenerationRequest): Promise<AiGenerationResult> {
    const completion = await callProviderJson<ChatCompletion>('OpenAI', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.name,
        messages: [
          { role: 'system', content: language ? subtitleSystemPrompt(language) : SCRIPT_SYSTEM_PROMPT },
          { role: 'user', content: composedPrompt },
        ],
      }),
    });

    const contentText = completion.choices[0]?.message.content?.trim() ?? '';
    const completionTokens = completion.usage?.completion_tokens ?? Math.ceil(contentText.length / 4);
    return {
      outputUnits: Math.max(1, Math.ceil(completionTokens / TOKENS_PER_UNIT)),
      contentText,
      mimeType: 'text/plain',
    };
  }
}
