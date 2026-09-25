import { ConflictException } from '@nestjs/common';
import { SubmissionStatus, SubmissionType } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';

// While the latest cut is with the Reviewer, or once it is approved, its scenes are frozen.
const LOCKING: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.UNDER_REVIEW,
  SubmissionStatus.APPROVED,
];

/** Refuses production changes to a plan whose episode cut is under review or approved. */
export async function assertCutOpen(prisma: PrismaService, planId: string) {
  const latest = await prisma.submission.findFirst({
    where: { productionPlanId: planId, submissionType: SubmissionType.EPISODE },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (latest && LOCKING.includes(latest.status)) {
    throw new ConflictException(`The episode cut is ${latest.status}; its scenes can no longer be changed`);
  }
}
