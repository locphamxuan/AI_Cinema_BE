import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProviderJson } from './http';

interface FalImageResult {
  images: { url: string; content_type?: string }[];
  seed?: number;
}

const LORA_SCALE = 1;

/**
 * Scene images, posters and thumbnails through FLUX.1 [dev] on fal.ai. A job of a
 * genre with a trained Genre Style LoRA runs on the LoRA endpoint with that adapter.
 * fal hosts the output, so the image URL is stored as is.
 */
export class FalImageProvider implements AiGenerationProvider {
  readonly name = 'fal';

  constructor(private readonly apiKey: string) {}

  async generate({ model, composedPrompt, seed, loraWeights }: AiGenerationRequest): Promise<AiGenerationResult> {
    const endpoint = loraWeights ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev';
    const result = await callProviderJson<FalImageResult>('fal.ai', `https://fal.run/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: composedPrompt,
        image_size: 'landscape_16_9',
        num_images: 1,
        ...(seed != null && { seed }),
        ...(loraWeights && { loras: [{ path: loraWeights, scale: LORA_SCALE }] }),
      }),
    });

    const image = result.images[0];
    if (!image) throw new Error('fal.ai returned no image');
    return {
      // Flat price per image: the catalog's baseUnits is the cost of one 16:9 frame.
      outputUnits: model.baseUnits,
      storageKey: image.url,
      mimeType: image.content_type ?? 'image/jpeg',
    };
  }
}
