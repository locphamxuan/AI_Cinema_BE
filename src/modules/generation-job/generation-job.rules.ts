import { BadRequestException } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType, Prisma } from '@prisma/client';

export const CANCELLABLE: GenerationJobStatus[] = [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED];
export const RUNNABLE: GenerationJobStatus[] = [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED];
export const DISCARDABLE: GenerationJobStatus[] = [
  ...CANCELLABLE,
  GenerationJobStatus.COMPLETED,
  GenerationJobStatus.FAILED,
];
export const LANGUAGE_JOB_TYPES: GenerationJobType[] = [GenerationJobType.SUBTITLE, GenerationJobType.TRANSLATION];
export const VISUAL_JOB_TYPES: GenerationJobType[] = [
  GenerationJobType.SCENE_IMAGE,
  GenerationJobType.SCENE_VIDEO,
  GenerationJobType.POSTER,
  GenerationJobType.THUMBNAIL,
];

export const JOB_INCLUDE = {
  aiModel: true,
  prompt: true,
  scene: { select: { id: true, title: true } },
  generatedAssets: true,
} satisfies Prisma.GenerationJobInclude;

const QUOTA_SELECT = { select: { id: true, allocationType: true, remainingAmount: true } } as const;

export const JOB_LIST_INCLUDE = {
  ...JOB_INCLUDE,
  quotaAllocation: QUOTA_SELECT,
} satisfies Prisma.GenerationJobInclude;

export const JOB_DETAIL_INCLUDE = {
  ...JOB_INCLUDE,
  createdBy: { select: { fullName: true } },
  quotaAllocation: QUOTA_SELECT,
  usageEntries: { orderBy: { recordedAt: 'asc' } },
} satisfies Prisma.GenerationJobInclude;

export interface NewAttempt {
  planId: string;
  jobType: GenerationJobType;
  rawPrompt: string | null;
  customFunction: string | null;
  language: string | null;
  sceneId: string | null;
  parentJobId: string | null;
  attemptNumber: number;
  configSnapshot: Prisma.InputJsonValue | undefined;
  createdById: string;
}

/** Checks the inputs every job type needs before anything is looked up or charged. */
export function assertAttemptInput({ jobType, rawPrompt, customFunction, language }: NewAttempt) {
  if (jobType !== GenerationJobType.VIDEO_ASSEMBLY && !rawPrompt?.trim()) {
    throw new BadRequestException('prompt is required');
  }
  if (jobType === GenerationJobType.CUSTOM && !customFunction?.trim()) {
    throw new BadRequestException('customFunction is required for a CUSTOM job');
  }
  if (LANGUAGE_JOB_TYPES.includes(jobType) && !language) {
    throw new BadRequestException(`language is required for a ${jobType} job`);
  }
}
