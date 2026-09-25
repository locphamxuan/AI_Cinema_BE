/**
 * Level 1 Orchestrator boundary for genre-style LoRA training: this app
 * never runs training itself (no self-managed GPU infra). It only submits
 * a dataset to a hosted training service (fal.ai, Replicate, ...) and later
 * receives/polls a result. Swap MockLoraTrainingProvider for a real HTTP
 * adapter per provider without touching GenreStyleModelService.
 */
export interface LoraTrainingSubmission {
  baseModelName: string;
  triggerKeyword: string;
  samples: { storageKey: string; caption?: string | null }[];
}

export interface LoraTrainingHandle {
  externalTrainingJobId: string;
}

export interface LoraTrainingProvider {
  readonly name: string;
  submitTraining(submission: LoraTrainingSubmission): Promise<LoraTrainingHandle>;
}

export const LORA_TRAINING_PROVIDER = 'LORA_TRAINING_PROVIDER';

/** Dev/test stand-in — mirrors the MockAiProvider convention (docs/PROJECT_OVERVIEW.md §6). */
export class MockLoraTrainingProvider implements LoraTrainingProvider {
  readonly name = 'mock';

  submitTraining(submission: LoraTrainingSubmission): Promise<LoraTrainingHandle> {
    return Promise.resolve({
      externalTrainingJobId: `mock-lora-job-${submission.triggerKeyword}-${Date.now()}`,
    });
  }
}
