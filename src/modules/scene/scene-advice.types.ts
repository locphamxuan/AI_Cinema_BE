import type { GenerationJobType } from '@prisma/client';

export type SceneAspect = 'video' | 'voice' | 'audio' | 'lighting' | 'camera' | 'continuity';

export interface SceneGap {
  aspect: SceneAspect;
  message: string;
}

export interface SceneSuggestion {
  jobType: GenerationJobType;
  title: string;
  reason: string;
  prompt: string;
}

export interface SceneLink {
  number: number;
  title: string;
}

export interface SceneAdvice {
  source: 'ai' | 'rules';
  summary: string;
  gaps: SceneGap[];
  suggestions: SceneSuggestion[];
  /** The neighbouring scenes this one must cut together with. */
  previousScene: SceneLink | null;
  nextScene: SceneLink | null;
}

export interface PlanContinuity {
  source: 'ai' | 'rules';
  summary: string;
  scenes: { sceneId: string; sceneNumber: number; issues: string[] }[];
}

export interface FilmContext {
  film: string;
  synopsis: string | null;
  genre: string | null;
}
