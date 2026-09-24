import { AiModality, GenerationJobType } from '@prisma/client';

/**
 * Level 1 AI Orchestrator model catalog (PROJECT_OVERVIEW.md §4.1.7, §4.1.8):
 * the platform only calls existing third-party models — one specialist per
 * generation function — and never trains/fine-tunes them. The single
 * exception is FLUX (open-weight), which can host Genre Style LoRA adapters
 * (§4.1.8.1, see genre-style-model module).
 *
 * prisma/seed.ts registers every entry into ai_providers/ai_models, and
 * AiModelRouterService resolves a job's model from JOB_TYPE_ROUTING — the
 * Creator never picks a model (BR-40).
 */
export interface AiModelCatalogEntry {
  provider: string;
  name: string;
  version: string;
  modality: AiModality;
  // Open weights → can be a LoRA base model; closed APIs cannot be trained.
  isOpenWeight: boolean;
}

export const AI_MODEL_CATALOG = {
  llm: {
    provider: 'OpenAI',
    name: 'gpt-4o-mini',
    version: '2024-07-18',
    modality: AiModality.TEXT,
    isOpenWeight: false,
  },
  tts: {
    provider: 'ElevenLabs',
    name: 'eleven_multilingual_v2',
    version: 'v2',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
  },
  music: {
    provider: 'ElevenLabs',
    name: 'eleven_music',
    version: 'v1',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
  },
  image: {
    provider: 'fal.ai',
    name: 'flux-dev',
    version: '1.0',
    modality: AiModality.IMAGE,
    isOpenWeight: true,
  },
  video: {
    provider: 'Google',
    name: 'veo-3',
    version: '3.0',
    modality: AiModality.VIDEO,
    isOpenWeight: false,
  },
} as const satisfies Record<string, AiModelCatalogEntry>;

export type AiModelCatalogKey = keyof typeof AI_MODEL_CATALOG;

// Record over the full enum so a new GenerationJobType fails to compile
// until it is routed to a model.
export const JOB_TYPE_ROUTING: Record<GenerationJobType, AiModelCatalogKey> = {
  SCRIPT: 'llm',
  SUBTITLE: 'llm',
  TRANSLATION: 'llm',
  VOICE: 'tts',
  BACKGROUND_AUDIO: 'music',
  POSTER: 'image',
  THUMBNAIL: 'image',
  VIDEO_ASSEMBLY: 'video',
};

export function catalogEntryForJobType(jobType: GenerationJobType): AiModelCatalogEntry {
  return AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]];
}
