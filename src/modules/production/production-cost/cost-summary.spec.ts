import { StudioMilestoneStatus } from '@prisma/client';
import { committedOf, summariseCost } from './cost-summary';

const handoff = (milestoneStatus: StudioMilestoneStatus, offeredFeeVnd: number, forfeitedVnd = 0) => ({
  milestoneStatus,
  offeredFeeVnd: BigInt(offeredFeeVnd),
  forfeitedVnd: BigInt(forfeitedVnd),
});

describe('cost summary', () => {
  it('commits the whole fee of a live hand-off and only the forfeited part of a replaced one', () => {
    expect(committedOf(handoff(StudioMilestoneStatus.IN_PROGRESS, 100_000_000))).toBe(100_000_000);
    expect(committedOf(handoff(StudioMilestoneStatus.SUPERSEDED, 100_000_000, 20_000_000))).toBe(20_000_000);
  });

  it('leaves the budget minus what studios hold', () => {
    const summary = summariseCost(200_000_000, [
      handoff(StudioMilestoneStatus.SUPERSEDED, 100_000_000, 20_000_000),
      handoff(StudioMilestoneStatus.BRIEF_SENT, 150_000_000),
    ]);
    expect(summary).toEqual({ budgetVnd: 200_000_000, committedVnd: 170_000_000, remainingVnd: 30_000_000 });
  });

  it('never reports less than nothing left', () => {
    expect(summariseCost(10_000, [handoff(StudioMilestoneStatus.DELIVERED, 50_000)]).remainingVnd).toBe(0);
  });
});
