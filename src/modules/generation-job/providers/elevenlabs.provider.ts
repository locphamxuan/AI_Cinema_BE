import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProvider } from './http';
import type { MediaStorage } from './media-storage';

const API = 'https://api.elevenlabs.io/v1';
// mp3_44100_128 → 128 kbit/s, so the byte count gives the length without decoding.
const OUTPUT_FORMAT = 'mp3_44100_128';
const MP3_BYTES_PER_SECOND = 128_000 / 8;
// ElevenLabs' stock "George" voice, used until a project picks its own.
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

/** Voice-over (text-to-speech) and background music through ElevenLabs; the mp3 goes to media storage. */
export class ElevenLabsAudioProvider implements AiGenerationProvider {
  readonly name = 'elevenlabs';

  constructor(
    private readonly apiKey: string,
    private readonly storage: MediaStorage,
    private readonly voiceId = DEFAULT_VOICE_ID,
  ) {}

  async generate({ model, composedPrompt }: AiGenerationRequest): Promise<AiGenerationResult> {
    const isMusic = model.name === AI_MODEL_CATALOG.music.name;
    const response = isMusic
      ? await this.post('/music', {
          prompt: composedPrompt,
          music_length_ms: model.baseUnits * 1000,
          model_id: 'music_v1',
        })
      : await this.post(`/text-to-speech/${this.voiceId}`, { text: composedPrompt, model_id: model.name });

    const bytes = new Uint8Array(await response.arrayBuffer());
    const durationSeconds = Math.max(1, Math.round(bytes.byteLength / MP3_BYTES_PER_SECOND));
    return {
      outputUnits: durationSeconds,
      storageKey: await this.storage.upload(bytes, 'audio/mpeg', 'mp3'),
      mimeType: 'audio/mpeg',
      durationSeconds,
    };
  }

  private post(path: string, body: object) {
    return callProvider(
      'ElevenLabs',
      `${API}${path}?output_format=${OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body),
      },
      300_000,
    );
  }
}
