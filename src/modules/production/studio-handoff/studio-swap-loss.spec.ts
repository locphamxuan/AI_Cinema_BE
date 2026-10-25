import { EmailStatus, StudioMilestoneStatus } from '@prisma/client';
import { lostOnReplace } from './studio-swap-loss';

const handoff = (milestoneStatus: StudioMilestoneStatus, status: EmailStatus | null = EmailStatus.SENT) => ({
  milestoneStatus,
  productionFeeTokens: 500_000n,
  emailMessage: status ? { status } : null,
});

describe('lostOnReplace (BR-59)', () => {
  it.each([
    StudioMilestoneStatus.BRIEF_SENT,
    StudioMilestoneStatus.STUDIO_ACCEPTED,
    StudioMilestoneStatus.IN_PROGRESS,
    StudioMilestoneStatus.DELIVERED,
  ])('spends the whole fee of a studio that got the brief (%s)', (status) => {
    expect(lostOnReplace(handoff(status))).toBe(500_000n);
  });

  it('costs nothing when the studio declined', () => {
    expect(lostOnReplace(handoff(StudioMilestoneStatus.STUDIO_DECLINED))).toBe(0n);
  });

  it('costs nothing when the brief never left', () => {
    expect(lostOnReplace(handoff(StudioMilestoneStatus.BRIEF_SENT, EmailStatus.FAILED))).toBe(0n);
  });

  it('counts a brief still queued as sent', () => {
    expect(lostOnReplace(handoff(StudioMilestoneStatus.BRIEF_SENT, EmailStatus.QUEUED))).toBe(500_000n);
  });
});
