import { AiModality } from '@prisma/client';
import type { AiGenerationProvider, AiGenerationRequest, AiGenerationResult } from '../ai-generation-provider';
import { callProvider, QuotaExceededError } from './http';
import { callSpace } from './gradio-space';
import type { MediaStorage } from './media-storage';

const IMAGE_MODEL_URL =
  'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers';
const VIDEO_SPACE = 'Lightricks/ltx-video-distilled';
const NEGATIVE_PROMPT = 'worst quality, inconsistent motion, blurry, jittery, distorted';
// Longer clips spend more of the daily free GPU time; 4s keeps several clips a day possible.
export const DEFAULT_VIDEO_SECONDS = 4;
const MAX_VIDEO_SECONDS = 8;

interface GradioVideo {
  video: { url: string };
}

const isQuotaMessage = (message: string) => /quota|exceeded|too many requests|429|402/i.test(message);

/**
 * Scene images (Stable Diffusion 3 on HF Inference) and scene video (LTX-Video on a ZeroGPU
 * Space) on Hugging Face's free tier. Both outputs are copied to media storage, since the
 * links Hugging Face hands back expire.
 */
export class HuggingFaceProvider implements AiGenerationProvider {
  readonly name = 'huggingface';

  constructor(
    private readonly token: string,
    private readonly storage: MediaStorage,
    private readonly videoSeconds = DEFAULT_VIDEO_SECONDS,
  ) {}

  generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    return request.model.modality === AiModality.VIDEO ? this.video(request) : this.image(request);
  }

  private async image({ model, composedPrompt, seed }: AiGenerationRequest): Promise<AiGenerationResult> {
    let response: Response;
    try {
      response = await callProvider('Hugging Face', IMAGE_MODEL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'image/jpeg' },
        body: JSON.stringify({
          inputs: composedPrompt,
          parameters: { width: 1024, height: 576, num_inference_steps: 20, ...(seed != null && { seed }) },
        }),
      });
    } catch (error) {
      if (error instanceof Error && / (429|402):/.test(error.message))
        throw new QuotaExceededError('Hugging Face', error.message);
      throw error;
    }
    const mimeType = response.headers.get('content-type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      // Flat price per image: the catalog's baseUnits is the cost of one 16:9 frame.
      outputUnits: model.baseUnits,
      storageKey: await this.storage.upload(bytes, mimeType, mimeType.includes('png') ? 'png' : 'jpg'),
      mimeType,
    };
  }

  private async video({ composedPrompt, seed }: AiGenerationRequest): Promise<AiGenerationResult> {
    const seconds = Math.min(MAX_VIDEO_SECONDS, Math.max(1, this.videoSeconds));
    let clip: GradioVideo;
    try {
      const data = await callSpace(VIDEO_SPACE, this.token, '/text_to_video', {
        prompt: composedPrompt,
        negative_prompt: NEGATIVE_PROMPT,
        input_image_filepath: null,
        input_video_filepath: null,
        height_ui: 512,
        width_ui: 896,
        mode: 'text-to-video',
        duration_ui: seconds,
        ui_frames_to_use: 9,
        seed_ui: seed ?? 42,
        randomize_seed: seed == null,
        ui_guidance_scale: 1,
        improve_texture_flag: true,
      });
      clip = (data as [GradioVideo, number])[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      if (isQuotaMessage(message)) throw new QuotaExceededError('Hugging Face ZeroGPU', message);
      throw new Error(`Hugging Face video failed: ${message.slice(0, 300)}`);
    }

    const download = await callProvider(
      'Hugging Face',
      clip.video.url,
      { headers: { Authorization: `Bearer ${this.token}` } },
      300_000,
    );
    const bytes = new Uint8Array(await download.arrayBuffer());
    return {
      outputUnits: seconds,
      storageKey: await this.storage.upload(bytes, 'video/mp4', 'mp4'),
      mimeType: 'video/mp4',
      durationSeconds: seconds,
    };
  }
}
