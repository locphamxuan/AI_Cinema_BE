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
 *
 * Cost (BR-41) grows with output length: tokens = outputUnits × tokensPerUnit,
 * where baseUnits is the typical output length used for the planning estimate.
 */
export interface AiModelCatalogEntry {
  provider: string;
  name: string;
  version: string;
  modality: AiModality;
  // Open weights → can be a LoRA base model; closed APIs cannot be trained.
  isOpenWeight: boolean;
  baseUnits: number;
  tokensPerUnit: number;
}

export const AI_MODEL_CATALOG = {
  llm: {
    provider: 'OpenAI',
    name: 'gpt-4o-mini',
    version: '2024-07-18',
    modality: AiModality.TEXT,
    isOpenWeight: false,
    baseUnits: 10,
    tokensPerUnit: 4,
  },
  tts: {
    provider: 'ElevenLabs',
    name: 'eleven_multilingual_v2',
    version: 'v2',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
    baseUnits: 14,
    tokensPerUnit: 2.5,
  },
  music: {
    provider: 'ElevenLabs',
    name: 'eleven_music',
    version: 'v1',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
    baseUnits: 25,
    tokensPerUnit: 1,
  },
  image: {
    provider: 'fal.ai',
    name: 'flux-dev',
    version: '1.0',
    modality: AiModality.IMAGE,
    isOpenWeight: true,
    baseUnits: 5,
    tokensPerUnit: 6,
  },
  video: {
    provider: 'Google',
    name: 'veo-3',
    version: '3.0',
    modality: AiModality.VIDEO,
    isOpenWeight: false,
    baseUnits: 20,
    tokensPerUnit: 3,
  },
} as const satisfies Record<string, AiModelCatalogEntry>;

export type AiModelCatalogKey = keyof typeof AI_MODEL_CATALOG;

// Record over the full enum so a new GenerationJobType fails to compile
// until it is routed to a model. CUSTOM is refined by resolveCatalogKey().
export const JOB_TYPE_ROUTING: Record<GenerationJobType, AiModelCatalogKey> = {
  SCRIPT: 'llm',
  SUBTITLE: 'llm',
  TRANSLATION: 'llm',
  VOICE: 'tts',
  BACKGROUND_AUDIO: 'music',
  POSTER: 'image',
  THUMBNAIL: 'image',
  SCENE_IMAGE: 'image',
  VIDEO_ASSEMBLY: 'video',
  SCENE_VIDEO: 'video',
  CUSTOM: 'llm',
};

/** How the model of a job was found (docs: generation_steps.model_match). */
export type ModelMatch = 'catalog' | 'specialist' | 'general';

// A CUSTOM function described by the Creator goes to the catalog model whose
// speciality its description mentions; otherwise to the general-purpose LLM.
const CUSTOM_SPECIALITIES: [AiModelCatalogKey, string[]][] = [
  ['video', ['video', 'chuyen dong', 'motion', 'hoat hinh', 'animation', 'vfx', 'hieu ung', 'khau hinh', 'lip']],
  ['image', ['anh', 'image', 'poster', 'thumbnail', 'bia', 'mau', 'color', 'upscale']],
  ['tts', ['giong', 'long tieng', 'voice', 'thuyet minh']],
  ['music', ['nhac', 'music', 'am thanh', 'sfx', 'sound']],
];

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

export function resolveCatalogKey(
  jobType: GenerationJobType,
  customFunction?: string | null,
): { key: AiModelCatalogKey; match: ModelMatch } {
  if (jobType !== GenerationJobType.CUSTOM) return { key: JOB_TYPE_ROUTING[jobType], match: 'catalog' };

  // Whole-word match, so "anh" (image) does not fire on "cảnh" or "nhanh".
  const label = ` ${normalize(customFunction ?? '').replace(/[^a-z0-9]+/g, ' ')} `;
  const specialist = CUSTOM_SPECIALITIES.find(([, keywords]) => keywords.some((k) => label.includes(` ${k} `)));
  return specialist ? { key: specialist[0], match: 'specialist' } : { key: JOB_TYPE_ROUTING.CUSTOM, match: 'general' };
}

export function catalogEntryForJobType(jobType: GenerationJobType): AiModelCatalogEntry {
  return AI_MODEL_CATALOG[JOB_TYPE_ROUTING[jobType]];
}

/** Planning estimate checked against quota before a job runs (BR-41). */
export function estimateTokenCost(entry: AiModelCatalogEntry): number {
  return Math.round(entry.baseUnits * entry.tokensPerUnit);
}
