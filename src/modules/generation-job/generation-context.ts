import { NotFoundException } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType, Prisma } from '@prisma/client';
import type { Scene } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';
import { type NewAttempt, VISUAL_JOB_TYPES } from './generation-job.rules';
import type { PromptComposeInput } from './prompt-composer';

/** The visual prompt last generated for the scene before this one, for a continuous look. */
export async function previousScenePrompt(
  prisma: PrismaService,
  planId: string,
  sceneNumber: number,
): Promise<string | null> {
  const job = await prisma.generationJob.findFirst({
    where: {
      productionPlanId: planId,
      status: GenerationJobStatus.COMPLETED,
      jobType: { in: [GenerationJobType.SCENE_VIDEO, GenerationJobType.SCENE_IMAGE] },
      scene: { sceneNumber: { lt: sceneNumber } },
    },
    orderBy: [{ scene: { sceneNumber: 'desc' } }, { createdAt: 'desc' }],
    select: { prompt: { select: { composedPrompt: true } } },
  });
  return job?.prompt?.composedPrompt ?? null;
}

export async function requirePlan(prisma: PrismaService, planId: string) {
  const plan = await prisma.productionPlan.findUnique({
    where: { id: planId },
    include: {
      productionProject: {
        select: { status: true, title: true, description: true, primaryGenre: { select: { name: true } } },
      },
    },
  });
  if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
  return plan;
}

/** The LoRA weights a genre-styled job was queued with (kept in its config snapshot). */
export function loraWeightsOf(configSnapshot: Prisma.JsonValue): string | null {
  const snapshot = configSnapshot as { loraWeights?: string } | null;
  return snapshot?.loraWeights ?? null;
}

/** What the Prompt Composer gets: the Creator's request plus the film and scene around it. */
export async function composeInput(
  prisma: PrismaService,
  context: {
    plan: Awaited<ReturnType<typeof requirePlan>>;
    scene: Scene | null;
    attempt: NewAttempt;
    loraTriggerKeyword?: string | null;
  },
): Promise<PromptComposeInput> {
  const { plan, scene, attempt } = context;
  const { jobType } = attempt;
  const project = plan.productionProject;
  return {
    jobType,
    rawPrompt: attempt.rawPrompt ?? '',
    sceneTitle: scene?.title,
    sceneDescription: scene?.description,
    scriptText: jobType === GenerationJobType.SCRIPT ? plan.scriptText : null,
    customFunction: attempt.customFunction,
    loraTriggerKeyword: context.loraTriggerKeyword,
    projectTitle: project.title,
    projectSynopsis: project.description,
    genre: project.primaryGenre?.name,
    previousScenePrompt:
      scene && VISUAL_JOB_TYPES.includes(jobType)
        ? await previousScenePrompt(prisma, plan.id, scene.sceneNumber)
        : null,
  };
}
