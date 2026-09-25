import { AiModality } from '@prisma/client';
import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProviderJson, QuotaExceededError } from './http';
import type { MediaStorage } from './media-storage';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// One billing unit of text output = this many Gemini output tokens (catalog baseUnits 10 ≈ 1000 tokens).
const TOKENS_PER_UNIT = 100;
const TTS_VOICE = 'Kore';
// Gemini speech is raw 16-bit mono PCM at 24 kHz.
const PCM_RATE = 24_000;
const PCM_BYTES_PER_SECOND = PCM_RATE * 2;

const SCRIPT_INSTRUCTION =
  'You are the screenwriter of an AI-produced film. Follow the direction exactly and answer with the requested text only.';
const subtitleInstruction = (language: string) =>
  `You write film subtitles. Turn the direction into the spoken line(s) of the scene in the language "${language}". ` +
  'Answer with the subtitle text only, no quotes, no timestamps.';

interface GenerateContentResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] };
  }[];
  usageMetadata?: { candidatesTokenCount?: number };
}

/**
 * Script, subtitles and voice-over through the Gemini API free tier (a key from a
 * Google AI Studio project without billing can never be charged; over the free quota
 * the API answers 429, which falls back to the sample library).
 */
export class GeminiProvider implements AiGenerationProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly storage: MediaStorage,
  ) {}

  generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    return request.model.modality === AiModality.AUDIO ? this.speak(request) : this.write(request);
  }

  private async write({ model, composedPrompt, language }: AiGenerationRequest): Promise<AiGenerationResult> {
    const response = await this.call(model.name, {
      systemInstruction: { parts: [{ text: language ? subtitleInstruction(language) : SCRIPT_INSTRUCTION }] },
      contents: [{ parts: [{ text: composedPrompt }] }],
    });
    const contentText =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim() ?? '';
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? Math.ceil(contentText.length / 4);
    return { outputUnits: Math.max(1, Math.ceil(outputTokens / TOKENS_PER_UNIT)), contentText, mimeType: 'text/plain' };
  }

  private async speak({ model, composedPrompt }: AiGenerationRequest): Promise<AiGenerationResult> {
    const response = await this.call(model.name, {
      // The speech models only answer an explicit instruction to read the text.
      contents: [{ parts: [{ text: `Read this aloud in a natural, cinematic voice: ${composedPrompt}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
      },
    });
    const audio = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!audio)
      throw new Error(`Gemini returned no speech (${response.candidates?.[0]?.finishReason ?? 'no candidate'})`);

    const pcm = Buffer.from(audio.data, 'base64');
    const durationSeconds = Math.max(1, Math.round(pcm.byteLength / PCM_BYTES_PER_SECOND));
    return {
      outputUnits: durationSeconds,
      storageKey: await this.storage.upload(wavOf(pcm), 'audio/wav', 'wav'),
      mimeType: 'audio/wav',
      durationSeconds,
    };
  }

  private async call(model: string, body: object): Promise<GenerateContentResponse> {
    try {
      return await callProviderJson<GenerateContentResponse>('Gemini', `${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof Error && / 429:/.test(error.message)) throw new QuotaExceededError('Gemini', error.message);
      throw error;
    }
  }
}

/** Wraps raw 16-bit mono PCM in a WAV header so browsers can play it. */
export function wavOf(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}
