import { AiModality, GenerationJobType } from '@prisma/client';

/**
 * Level 1 AI Orchestrator model catalog (PROJECT_OVERVIEW.md §4.1.7, §4.1.8):
 * the platform only calls existing third-party models — one specialist per
 * generation function — and never trains/fine-tunes them. Only free-tier
 * services are used (Gemini, Hugging Face), so running the platform never costs
 * money. Open-weight image models can host Genre Style LoRA adapters
 * (§4.1.8.1, see genre-style-model module).
 *
 * Migrations register every entry into ai_providers/ai_models, and
 * AiModelRouterService resolves a job's model from JOB_TYPE_ROUTING — the
 * Creator never picks a model (BR-40).
 *
 * Cost (BR-41) grows with output length: tokens = outputUnits × tokensPerUnit,
 * where baseUnits is the typical output length used for the planning estimate.
 * These tokens are the platform's own production credits, not money.
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
    provider: 'Google',
    name: 'gemini-2.5-flash-lite',
    version: '2.5',
    modality: AiModality.TEXT,
    isOpenWeight: false,
    baseUnits: 10,
    tokensPerUnit: 4,
  },
  tts: {
    provider: 'Google',
    name: 'gemini-2.5-flash-preview-tts',
    version: '2.5-preview',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
    baseUnits: 14,
    tokensPerUnit: 2.5,
  },
  // No free music model is served today: background music always comes from the sample library (mock).
  music: {
    provider: 'AI Cinema',
    name: 'sample-music',
    version: '1',
    modality: AiModality.AUDIO,
    isOpenWeight: false,
    baseUnits: 25,
    tokensPerUnit: 1,
  },
  image: {
    provider: 'Hugging Face',
    name: 'stable-diffusion-3-medium',
    version: '3-medium',
    modality: AiModality.IMAGE,
    isOpenWeight: true,
    baseUnits: 5,
    tokensPerUnit: 6,
  },
  video: {
    provider: 'Hugging Face',
    name: 'ltx-video-distilled',
    version: '0.9.7',
    modality: AiModality.VIDEO,
    // Open weights, but it runs on a hosted Space: no Genre Style LoRA is trained on it.
    isOpenWeight: false,
    baseUnits: 4,
    tokensPerUnit: 6,
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
