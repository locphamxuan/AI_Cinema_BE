import { ConflictException } from '@nestjs/common';
import { AiUsageEntryType, GenerationJobStatus, Prisma, QuotaAllocationStatus } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';
import { JOB_INCLUDE } from './generation-job.rules';

/**
 * Books the actual cost: one ledger row for the generation and one for the
 * Prompt Composer call, then an atomic decrement of the allocation. A cost the
 * allocation can no longer cover still lands in the ledger (the output exists),
 * and the allocation is closed at zero instead of hiding the overrun.
 */
export async function settleJob(
  tx: Prisma.TransactionClient,
  job: {
    id: string;
    productionPlanId: string;
    quotaAllocationId: string | null;
    prompt: { composeTokenCost: number } | null;
  },
  tokenCost: number,
  outputUnits: number | null,
) {
  const allocation = job.quotaAllocationId
    ? await tx.quotaAllocation.findUnique({ where: { id: job.quotaAllocationId } })
    : await activeAllocation(tx, job.productionPlanId);
  const composeCost = job.prompt?.composeTokenCost ?? 0;
  const total = tokenCost + composeCost;

  await tx.aiUsageLedger.createMany({
    data: [
      {
        generationJobId: job.id,
        productionPlanId: job.productionPlanId,
        quotaAllocationId: allocation?.id,
        entryType: AiUsageEntryType.GENERATION,
        outputDurationSeconds: outputUnits,
        tokenCost,
      },
      ...(composeCost > 0
        ? [
            {
              generationJobId: job.id,
              productionPlanId: job.productionPlanId,
              quotaAllocationId: allocation?.id,
              entryType: AiUsageEntryType.PROMPT_COMPOSE,
              tokenCost: composeCost,
            },
          ]
        : []),
    ],
  });

  if (allocation && total > 0) {
    const charged = await tx.quotaAllocation.updateMany({
      where: { id: allocation.id, remainingAmount: { gte: total } },
      data: { remainingAmount: { decrement: total } },
    });
    if (charged.count === 0) {
      await tx.quotaAllocation.update({
        where: { id: allocation.id },
        data: { remainingAmount: 0, status: QuotaAllocationStatus.CONSUMED },
      });
    } else {
      await tx.quotaAllocation.updateMany({
        where: { id: allocation.id, remainingAmount: 0 },
        data: { status: QuotaAllocationStatus.CONSUMED },
      });
    }
  }

  return tx.generationJob.update({
    where: { id: job.id },
    data: {
      status: GenerationJobStatus.COMPLETED,
      completedAt: new Date(),
      resourceCost: total,
      outputDurationSeconds: outputUnits,
      quotaAllocationId: allocation?.id ?? null,
    },
    include: JOB_INCLUDE,
  });
}

export function activeAllocation(client: Prisma.TransactionClient | PrismaService, planId: string, required = 0) {
  return client.quotaAllocation.findFirst({
    where: { productionPlanId: planId, status: QuotaAllocationStatus.ACTIVE, remainingAmount: { gte: required } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * BR-15: the estimate must fit in the plan's active quota before anything is generated.
 * With a top-up the plan holds several ACTIVE allocations; the oldest one that can cover it pays.
 */
export async function reserveAllocation(prisma: PrismaService, planId: string, required: number) {
  const allocation = await activeAllocation(prisma, planId, required);
  if (allocation) return allocation;

  const active = await prisma.quotaAllocation.findMany({
    where: { productionPlanId: planId, status: QuotaAllocationStatus.ACTIVE },
    select: { remainingAmount: true },
  });
  if (active.length === 0) throw new ConflictException('The plan has no active AI quota allocation');
  const left = Math.max(...active.map((a) => Number(a.remainingAmount)));
  throw new ConflictException(`quota_exceeded: needs ${required} tokens, ${left} left`);
}
