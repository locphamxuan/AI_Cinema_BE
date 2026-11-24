import { ConflictException } from '@nestjs/common';
import type { PolicyType, Prisma } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/** Policies switched on whose validity window covers `now`: the ones a Reviewer must follow. */
export function inForceWhere(now = new Date()): Prisma.PolicyWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    ],
  };
}

/** The newest policy of `type` in force now; labels and compliance checks record which one they followed. */
export async function activePolicyId(tx: PrismaTx, type: PolicyType, now = new Date()): Promise<string> {
  const policy = await tx.policy.findFirst({
    where: { type, ...inForceWhere(now) },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!policy) {
    throw new ConflictException({
      message: `No ${type} policy is in force; ask an Admin to activate one`,
      details: { reason: 'NO_POLICY_IN_FORCE', type },
    });
  }
  return policy.id;
}
