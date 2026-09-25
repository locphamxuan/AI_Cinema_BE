import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProvider, callProviderJson, sleep } from './http';
import type { MediaStorage } from './media-storage';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_VEO_MODEL = 'veo-3.0-fast-generate-001';
// Veo 3 renders a fixed 8-second clip.
const CLIP_SECONDS = 8;
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 10 * 60_000;

interface VeoOperation {
  name: string;
  done?: boolean;
  error?: { message: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
}

/**
 * Scene video through Google Veo 3 on the Gemini API. Generation is a long-running
 * operation that is polled until done; the mp4 is then copied into media storage
 * because Google's download link needs the API key and expires.
 */
export class VeoVideoProvider implements AiGenerationProvider {
  readonly name = 'veo';

  constructor(
    private readonly apiKey: string,
    private readonly storage: MediaStorage,
    private readonly modelId = DEFAULT_VEO_MODEL,
  ) {}

  async generate({ composedPrompt, seed }: AiGenerationRequest): Promise<AiGenerationResult> {
    let operation = await callProviderJson<VeoOperation>(
      'Google Veo',
      `${API}/models/${this.modelId}:predictLongRunning`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          instances: [{ prompt: composedPrompt }],
          parameters: { aspectRatio: '16:9', ...(seed != null && { seed }) },
        }),
      },
    );

    const startedAt = Date.now();
    while (!operation.done) {
      if (Date.now() - startedAt > MAX_WAIT_MS)
        throw new Error(`Google Veo did not finish within ${MAX_WAIT_MS / 60_000} minutes`);
      await sleep(POLL_INTERVAL_MS);
      operation = await callProviderJson<VeoOperation>('Google Veo', `${API}/${operation.name}`, {
        headers: this.headers(),
      });
    }
    if (operation.error) throw new Error(`Google Veo failed: ${operation.error.message}`);

    const uri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error('Google Veo returned no video (the prompt may have been blocked by its safety filter)');

    const download = await callProvider('Google Veo', uri, { headers: this.headers() }, 300_000);
    const bytes = new Uint8Array(await download.arrayBuffer());
    return {
      outputUnits: CLIP_SECONDS,
      storageKey: await this.storage.upload(bytes, 'video/mp4', 'mp4'),
      mimeType: 'video/mp4',
      durationSeconds: CLIP_SECONDS,
    };
  }

  private headers() {
    return { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' };
  }
}
