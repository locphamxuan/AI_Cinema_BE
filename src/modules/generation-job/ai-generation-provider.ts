import { AiModality, AssetType } from '@prisma/client';
import type { AiModelCatalogEntry } from 'src/modules/ai-model/ai-model-catalog';

/**
 * Boundary to the third-party model APIs (the `AiProvider` interface of
 * PROJECT_OVERVIEW.md §6). A real adapter per provider replaces
 * MockAiGenerationProvider without touching GenerationJobService.
 */
export interface AiGenerationRequest {
  model: AiModelCatalogEntry;
  composedPrompt: string;
  seed?: number | null;
  loraWeights?: string | null;
}

export interface AiGenerationResult {
  // Output length in the model's unit (seconds of audio/video, text/frame units)
  outputUnits: number;
  contentText?: string;
  storageKey?: string;
  mimeType?: string;
  durationSeconds?: number;
}

export interface AiGenerationProvider {
  readonly name: string;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}

export const AI_GENERATION_PROVIDER = 'AI_GENERATION_PROVIDER';

/** Actual token cost of a generation — grows with output length, not a flat fee (BR-41). */
export function tokenCostOf(model: AiModelCatalogEntry, outputUnits: number): number {
  return Math.round(outputUnits * model.tokensPerUnit);
}

const PROMPT_LENGTH_CAP = 400;
const SAMPLE_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

/**
 * Dev/test stand-in (LI-01: no paid AI calls outside production). Output length
 * scales with prompt length so cost varies like a real provider's would.
 */
export class MockAiGenerationProvider implements AiGenerationProvider {
  readonly name = 'mock';

  generate({ model, composedPrompt, seed }: AiGenerationRequest): Promise<AiGenerationResult> {
    const promptFactor = 0.75 + (Math.min(composedPrompt.length, PROMPT_LENGTH_CAP) / PROMPT_LENGTH_CAP) * 0.5;
    const outputUnits = Math.round(model.baseUnits * promptFactor);

    switch (model.modality) {
      case AiModality.VIDEO:
        return Promise.resolve({
          outputUnits,
          storageKey: SAMPLE_HLS,
          mimeType: 'application/vnd.apple.mpegurl',
          durationSeconds: outputUnits,
        });
      case AiModality.IMAGE:
        return Promise.resolve({
          outputUnits,
          storageKey: `https://picsum.photos/seed/${seed ?? outputUnits}/1280/720`,
          mimeType: 'image/jpeg',
        });
      case AiModality.AUDIO:
        return Promise.resolve({ outputUnits, mimeType: 'audio/mpeg', durationSeconds: outputUnits });
      default:
        return Promise.resolve({
          outputUnits,
          contentText: `[mock ${model.name}] ${composedPrompt}`,
          mimeType: 'text/plain',
        });
    }
  }
}

/** Which GeneratedAsset a job produces; CUSTOM jobs follow the modality they were routed to. */
export function assetTypeFor(jobType: string, modality: AiModality): AssetType {
  const byJobType: Partial<Record<string, AssetType>> = {
    SCRIPT: AssetType.SCRIPT,
    TRANSLATION: AssetType.SUBTITLE,
    SUBTITLE: AssetType.SUBTITLE,
    VOICE: AssetType.DUB_AUDIO,
    BACKGROUND_AUDIO: AssetType.BACKGROUND_AUDIO,
    POSTER: AssetType.POSTER,
    THUMBNAIL: AssetType.THUMBNAIL,
    SCENE_IMAGE: AssetType.IMAGE,
    SCENE_VIDEO: AssetType.VIDEO,
    VIDEO_ASSEMBLY: AssetType.VIDEO,
  };
  const byModality: Record<AiModality, AssetType> = {
    TEXT: AssetType.SCRIPT,
    IMAGE: AssetType.IMAGE,
    AUDIO: AssetType.BACKGROUND_AUDIO,
    VIDEO: AssetType.VIDEO,
    MULTIMODAL: AssetType.SCRIPT,
  };
  return byJobType[jobType] ?? byModality[modality];
}
