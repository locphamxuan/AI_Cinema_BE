import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CostSummary } from 'src/modules/production/production-cost/cost-summary';
import { formatVnd } from './brief/brief-pdf';

/**
 * Fails fast, before the brief is built, when the fee cannot fit in the budget left plus what the replaced
 * studios give back; the hand-off checks again under the project lock when it is recorded.
 */
export function assertFeeFits(cost: Pick<CostSummary, 'remainingVnd'>, feeVnd: number, releasedVnd: number): void {
  const available = cost.remainingVnd + releasedVnd;
  if (feeVnd > available) {
    throw new ConflictException(
      `The fee (${formatVnd(feeVnd)}) is more than the budget left (${formatVnd(available)}); ask the Admin for more production cost`,
    );
  }
}

/**
 * Spreads what the replaced studio kept over the hand-offs being replaced, each up to its own offered fee
 * (BR-59). A scope usually has one live hand-off.
 */
export function splitForfeit(
  replaced: { id: string; offeredFeeVnd: bigint }[],
  forfeitedVnd: number,
): { id: string; forfeitedVnd: number }[] {
  const offered = replaced.reduce((sum, h) => sum + Number(h.offeredFeeVnd), 0);
  if (forfeitedVnd > offered) {
    throw new BadRequestException(`The replaced studio cannot keep more than its fee (${formatVnd(offered)})`);
  }
  let left = forfeitedVnd;
  return replaced.map(({ id, offeredFeeVnd }) => {
    const share = Math.min(left, Number(offeredFeeVnd));
    left -= share;
    return { id, forfeitedVnd: share };
  });
}
