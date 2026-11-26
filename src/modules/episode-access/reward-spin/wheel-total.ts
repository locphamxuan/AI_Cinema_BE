import { ConflictException } from '@nestjs/common';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/**
 * A prize `weight` is its chance in basis points: 1 = 0.01 %, 10 000 = 100 %. Every spin wins exactly one
 * prize, so the prizes switched on must add up to exactly 100 % (or the wheel has none switched on).
 */
export const WHEEL_TOTAL_BASIS_POINTS = 10_000;

export const WHEEL_REASON = {
  NOT_100: 'REWARD_WHEEL_NOT_100',
} as const;

/** "80", "99.5", "33.33": a basis-point total as the percent the Admin typed. */
const percentOf = (basisPoints: number) => String(basisPoints / 100);

/** Refuses a wheel whose active prizes would not add up to exactly 100 %; an empty wheel is allowed. */
export function assertWheelAddsUp(activeWeights: number[]): void {
  if (activeWeights.length === 0) return;
  const total = activeWeights.reduce((sum, weight) => sum + weight, 0);
  if (total === WHEEL_TOTAL_BASIS_POINTS) return;
  throw new ConflictException({
    message: `The prizes switched on would add up to ${percentOf(total)}%, not 100%`,
    details: {
      reason: WHEEL_REASON.NOT_100,
      totalBasisPoints: total,
      missingBasisPoints: WHEEL_TOTAL_BASIS_POINTS - total,
    },
  });
}

/** The weights of the active prizes other than `exceptId`, read under the lock the caller already holds. */
export async function otherActiveWeights(tx: PrismaTx, exceptId?: string): Promise<number[]> {
  const rows = await tx.rewardPrize.findMany({
    where: { isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { weight: true },
  });
  return rows.map((row) => row.weight);
}

/** Locks every prize row, so two Admins never rebalance or edit the wheel at once. */
export async function lockWheel(tx: PrismaTx): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "reward_prizes" ORDER BY "id" FOR UPDATE`;
}
