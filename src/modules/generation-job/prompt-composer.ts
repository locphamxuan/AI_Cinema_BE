import { Injectable, Logger } from '@nestjs/common';
import { GenerationJobType } from '@prisma/client';
import { GeminiTextClient } from './providers/gemini-text';

/**
 * Prompt Composer (PROJECT_OVERVIEW.md §4.1.7.1): turns the Creator's free-form
 * prompt plus the scene context into the prompt actually sent to the model.
 *
 * The media models (Stable Diffusion 3, LTX-Video) only understand English and read
 * the start of a prompt first, so the Creator's own request always leads and the
 * context only fills in what the request leaves open. A voice-over job gets the
 * spoken line alone, never the whole script.
 */
export interface PromptComposeInput {
  jobType: GenerationJobType;
  rawPrompt: string;
  sceneTitle?: string | null;
  sceneDescription?: string | null;
  scriptText?: string | null;
  customFunction?: string | null;
  loraTriggerKeyword?: string | null;
  projectTitle?: string | null;
  projectSynopsis?: string | null;
  genre?: string | null;
  /** Visual prompt of the previous finished scene, so the look stays continuous. */
  previousScenePrompt?: string | null;
}

export interface ComposedPrompt {
  composedPrompt: string;
  composeModel: string;
  // Fixed per call — not proportional to output length like generation cost (BR-41)
  composeTokenCost: number;
}

export interface PromptComposer {
  compose(input: PromptComposeInput): Promise<ComposedPrompt>;
}

export const PROMPT_COMPOSER = 'PROMPT_COMPOSER';

const COMPOSE_TOKEN_COST = 2;

type PromptKind = 'image' | 'video' | 'voice' | 'audio' | 'text';

const KIND_OF: Partial<Record<GenerationJobType, PromptKind>> = {
  SCENE_IMAGE: 'image',
  POSTER: 'image',
  THUMBNAIL: 'image',
  SCENE_VIDEO: 'video',
  VOICE: 'voice',
  BACKGROUND_AUDIO: 'audio',
};

const kindOf = (jobType: GenerationJobType): PromptKind => KIND_OF[jobType] ?? 'text';

const clean = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || undefined;

/** The words to be spoken: a quoted line if there is one, else what follows "Speaker:". */
export function spokenLine(rawPrompt: string): string {
  const quoted = /["“«](.+?)["”»]/s.exec(rawPrompt)?.[1];
  if (quoted?.trim()) return quoted.trim();
  const speaker = /^[^:\n]{1,40}:\s*(.+)$/s.exec(rawPrompt.trim())?.[1];
  return (speaker ?? rawPrompt).trim();
}

/** Offline composer: deterministic, used in tests and whenever the LLM is unavailable. */
export class TemplatePromptComposer implements PromptComposer {
  compose(input: PromptComposeInput): Promise<ComposedPrompt> {
    return Promise.resolve({
      composedPrompt: this.template(input),
      composeModel: 'template-prompt-composer',
      composeTokenCost: COMPOSE_TOKEN_COST,
    });
  }

  template(input: PromptComposeInput): string {
    const kind = kindOf(input.jobType);
    if (kind === 'voice') return spokenLine(input.rawPrompt);
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      return [
        clean(input.loraTriggerKeyword),
        clean(input.rawPrompt),
        clean(input.sceneDescription),
        clean(input.genre) && `${clean(input.genre)} film`,
        kind === 'audio' ? 'film soundtrack' : 'cinematic, highly detailed',
      ]
        .filter(Boolean)
        .join(', ');
    }
    return [
      `Direction: ${input.rawPrompt.trim()}`,
      input.customFunction && `Function: ${input.customFunction}`,
      input.projectTitle && `Film: ${input.projectTitle}`,
      input.projectSynopsis && `Synopsis: ${input.projectSynopsis}`,
      input.sceneTitle && `Scene: ${input.sceneTitle}`,
      input.sceneDescription && `Context: ${input.sceneDescription}`,
      input.scriptText && `Script: ${input.scriptText}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}

const VISUAL_RULES = (medium: 'image' | 'video') =>
  [
    `You turn a film Creator's request into ONE prompt for a text-to-${medium} model.`,
    "1. The Creator's request is the subject: keep every concrete element it asks for (characters, animals, objects, counts, actions, place, colours). Never drop or replace them and never add characters or objects it does not ask for.",
    '2. Write in English, 40 to 80 words, one paragraph, no lists, no quotes, no labels.',
    `3. Order: main subject and action first, then setting, lighting, ${medium === 'video' ? 'camera shot and movement' : 'framing'}, mood and colour palette.`,
    '4. Use the film and scene context only to fill in what the request leaves open (time of day, lighting, style). If the context conflicts with the request, follow the request.',
    '5. If a previous scene prompt is given, keep the same visual style so the scenes cut together.',
    'Answer with the prompt only.',
  ].join('\n');

const SYSTEM: Record<Exclude<PromptKind, 'text'>, string> = {
  image: VISUAL_RULES('image'),
  video: VISUAL_RULES('video'),
  voice:
    "You prepare a voice-over line for a text-to-speech model. From the Creator's request, return only the exact words the character says, in the language they are written in. Drop speaker names, stage directions and quotes. Answer with the spoken words only.",
  audio:
    "You turn a film Creator's request into ONE English prompt (at most 40 words) for a sound/music generation model: the sounds or music, instruments, tempo, mood. Keep everything the request asks for. Answer with the prompt only.",
};

/** Composes with the free Gemini text model; falls back to the template offline or on error. */
@Injectable()
export class GeminiPromptComposer implements PromptComposer {
  private readonly logger = new Logger(GeminiPromptComposer.name);
  private readonly template = new TemplatePromptComposer();

  constructor(private readonly gemini: GeminiTextClient) {}

  async compose(input: PromptComposeInput): Promise<ComposedPrompt> {
    const kind = kindOf(input.jobType);
    if (kind === 'text' || !this.gemini.isAvailable) return this.template.compose(input);

    try {
      const answer = await this.gemini.generate({ system: SYSTEM[kind], prompt: this.brief(input) });
      const composed = answer.replace(/^["'`]+|["'`]+$/g, '').trim();
      const lora = clean(input.loraTriggerKeyword);
      return {
        composedPrompt: lora && kind !== 'voice' ? `${lora}, ${composed}` : composed,
        composeModel: this.gemini.model,
        composeTokenCost: COMPOSE_TOKEN_COST,
      };
    } catch (error) {
      this.logger.warn(`Prompt Composer fell back to the template: ${(error as Error).message}`);
      return this.template.compose(input);
    }
  }

  private brief(input: PromptComposeInput): string {
    return [
      `Creator's request: ${input.rawPrompt.trim()}`,
      input.projectTitle && `Film: ${input.projectTitle}`,
      input.genre && `Genre: ${input.genre}`,
      input.projectSynopsis && `Synopsis: ${input.projectSynopsis}`,
      input.sceneTitle && `Scene: ${input.sceneTitle}`,
      input.sceneDescription && `Scene description: ${input.sceneDescription}`,
      input.previousScenePrompt && `Previous scene prompt: ${input.previousScenePrompt}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
