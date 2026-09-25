import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import {
  MockAiGenerationProvider,
  type AiGenerationProvider,
  type AiGenerationRequest,
  type AiGenerationResult,
} from '../ai-generation-provider';
import { GeminiProvider } from './gemini.provider';
import { QuotaExceededError } from './http';
import { DEFAULT_VIDEO_SECONDS, HuggingFaceProvider } from './huggingface.provider';
import { MediaStorage } from './media-storage';

/**
 * Sends each job to the free-tier service of its model (docs/ai-providers.md).
 * Only free tiers are wired in, so no key can ever cost money. Real calls need
 * AI_PROVIDER_MODE=live and the service's key; audio, images and video also need media
 * storage. Any other job — and any job whose free quota is used up — runs on the mock.
 */
@Injectable()
export class RoutingAiGenerationProvider implements AiGenerationProvider {
  readonly name = 'routing';
  private readonly logger = new Logger(RoutingAiGenerationProvider.name);
  private readonly mock = new MockAiGenerationProvider();
  private readonly byModel = new Map<string, AiGenerationProvider>();

  constructor(config: ConfigService, storage: MediaStorage) {
    if (config.get<string>('AI_PROVIDER_MODE') !== 'live') return;

    const key = (name: string) => config.get<string>(name)?.trim() || undefined;
    const gemini = key('GEMINI_API_KEY');
    const hfToken = key('HF_TOKEN');

    if (gemini) {
      const provider = new GeminiProvider(gemini, storage);
      this.byModel.set(AI_MODEL_CATALOG.llm.name, provider);
      if (storage.isConfigured) this.byModel.set(AI_MODEL_CATALOG.tts.name, provider);
    }
    if (hfToken && storage.isConfigured) {
      const seconds = Number(key('HF_VIDEO_SECONDS') ?? DEFAULT_VIDEO_SECONDS);
      const provider = new HuggingFaceProvider(hfToken, storage, seconds);
      this.byModel.set(AI_MODEL_CATALOG.image.name, provider);
      this.byModel.set(AI_MODEL_CATALOG.video.name, provider);
    }
    if (!storage.isConfigured && (gemini || hfToken)) {
      this.logger.warn('Media storage (S3_*) is not set: voice-over, images and video stay on the mock');
    }

    const live = [...this.byModel.keys()];
    this.logger.log(
      live.length
        ? `Live AI models: ${live.join(', ')}; the rest use the mock`
        : 'No AI key set: every job uses the mock',
    );
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const provider = this.byModel.get(request.model.name);
    if (!provider) return this.mock.generate(request);
    try {
      return await provider.generate(request);
    } catch (error) {
      if (!(error instanceof QuotaExceededError)) throw error;
      this.logger.warn(`${error.message} — ${request.model.name} falls back to the sample library`);
      return this.mock.generate(request);
    }
  }
}
