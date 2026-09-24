/**
 * Prompt Composer (PROJECT_OVERVIEW.md §4.1.7.1): turns the Creator's free-form
 * prompt plus the scene context into the detailed prompt actually sent to the
 * model, so generic moods typed by different Creators still produce distinct
 * output. The real implementation calls a cheap LLM; MockPromptComposer keeps
 * dev/test offline (same convention as MockLoraTrainingProvider).
 */
export interface PromptComposeInput {
  rawPrompt: string;
  sceneTitle?: string | null;
  sceneDescription?: string | null;
  scriptText?: string | null;
  customFunction?: string | null;
  loraTriggerKeyword?: string | null;
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

const MOCK_COMPOSE_TOKEN_COST = 2;

export class MockPromptComposer implements PromptComposer {
  compose(input: PromptComposeInput): Promise<ComposedPrompt> {
    const parts = [
      input.loraTriggerKeyword,
      input.customFunction && `Function: ${input.customFunction}`,
      input.sceneTitle && `Scene: ${input.sceneTitle}`,
      input.sceneDescription && `Context: ${input.sceneDescription}`,
      input.scriptText && `Script: ${input.scriptText}`,
      `Direction: ${input.rawPrompt}`,
    ].filter(Boolean);

    return Promise.resolve({
      composedPrompt: parts.join('\n'),
      composeModel: 'mock-prompt-composer',
      composeTokenCost: MOCK_COMPOSE_TOKEN_COST,
    });
  }
}
