import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import {
  MockAiGenerationProvider,
  type AiGenerationProvider,
  type AiGenerationRequest,
  type AiGenerationResult,
} from '../ai-generation-provider';
import { ElevenLabsAudioProvider } from './elevenlabs.provider';
import { FalImageProvider } from './fal.provider';
import { MediaStorage } from './media-storage';
import { OpenAiTextProvider } from './openai.provider';
import { VeoVideoProvider } from './veo.provider';

/**
 * Sends each job to the real API of its model's provider. Paid calls are opt-in
 * (LI-01): only with AI_PROVIDER_MODE=live, and only for providers whose key is set —
 * every other job keeps running on the mock, so the app works with any subset of keys.
 */
@Injectable()
export class RoutingAiGenerationProvider implements AiGenerationProvider {
  readonly name = 'routing';
  private readonly logger = new Logger(RoutingAiGenerationProvider.name);
  private readonly mock = new MockAiGenerationProvider();
  private readonly byProvider = new Map<string, AiGenerationProvider>();

  constructor(config: ConfigService, storage: MediaStorage) {
    if (config.get<string>('AI_PROVIDER_MODE') !== 'live') return;

    const key = (name: string) => config.get<string>(name)?.trim() || undefined;
    const openAi = key('OPENAI_API_KEY');
    const elevenLabs = key('ELEVENLABS_API_KEY');
    const fal = key('FAL_KEY');
    const gemini = key('GEMINI_API_KEY');

    if (openAi) this.byProvider.set(AI_MODEL_CATALOG.llm.provider, new OpenAiTextProvider(openAi));
    if (fal) this.byProvider.set(AI_MODEL_CATALOG.image.provider, new FalImageProvider(fal));
    // Audio and video come back as bytes, so they also need somewhere to store them.
    if (storage.isConfigured) {
      if (elevenLabs) {
        const provider = new ElevenLabsAudioProvider(elevenLabs, storage, key('ELEVENLABS_VOICE_ID'));
        this.byProvider.set(AI_MODEL_CATALOG.tts.provider, provider);
      }
      if (gemini)
        this.byProvider.set(AI_MODEL_CATALOG.video.provider, new VeoVideoProvider(gemini, storage, key('VEO_MODEL')));
    } else if (elevenLabs || gemini) {
      this.logger.warn('ElevenLabs/Veo keys are set but S3 media storage is not: audio and video stay on the mock');
    }

    const live = [...this.byProvider.keys()];
    this.logger.log(
      live.length
        ? `Live AI providers: ${live.join(', ')}; the rest use the mock`
        : 'No AI key set: every job uses the mock',
    );
  }

  generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    return (this.byProvider.get(request.model.provider) ?? this.mock).generate(request);
  }
}
