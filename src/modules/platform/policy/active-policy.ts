import { ConflictException } from '@nestjs/common';
import type { PolicyType } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/** The newest policy of `type` in force now; labels and compliance checks record which one they followed. */
export async function activePolicyId(tx: PrismaTx, type: PolicyType, now = new Date()): Promise<string> {
  const policy = await tx.policy.findFirst({
    where: {
      type,
      isActive: true,
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!policy) throw new ConflictException(`No ${type} policy is in force; ask an Admin to activate one`);
  return policy.id;
}
