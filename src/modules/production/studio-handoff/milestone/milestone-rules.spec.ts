import { StudioMilestoneStatus as Milestone } from '@prisma/client';
import { assertMilestoneInput, assertMilestoneMove } from './milestone-rules';

describe('assertMilestoneMove', () => {
  it.each([
    [Milestone.BRIEF_SENT, Milestone.STUDIO_ACCEPTED],
    [Milestone.BRIEF_SENT, Milestone.STUDIO_DECLINED],
    [Milestone.STUDIO_ACCEPTED, Milestone.IN_PROGRESS],
    [Milestone.IN_PROGRESS, Milestone.DELIVERED],
    [Milestone.DELIVERED, Milestone.IN_PROGRESS],
  ])('allows %s → %s', (from, to) => {
    expect(() => assertMilestoneMove(from, to)).not.toThrow();
  });

  it.each([
    [Milestone.BRIEF_SENT, Milestone.DELIVERED],
    [Milestone.STUDIO_ACCEPTED, Milestone.DELIVERED],
    [Milestone.STUDIO_DECLINED, Milestone.IN_PROGRESS],
    [Milestone.SUPERSEDED, Milestone.IN_PROGRESS],
    [Milestone.IN_PROGRESS, Milestone.BRIEF_SENT],
  ])('refuses %s → %s', (from, to) => {
    expect(() => assertMilestoneMove(from, to)).toThrow('cannot go from');
  });
});

describe('assertMilestoneInput', () => {
  it('needs a reason to decline', () => {
    expect(() => assertMilestoneInput(Milestone.STUDIO_DECLINED, { note: '  ' })).toThrow('why the studio declined');
    expect(() => assertMilestoneInput(Milestone.STUDIO_DECLINED, { note: 'Busy' })).not.toThrow();
  });

  it('needs the Submission to deliver, and only then accepts one', () => {
    expect(() => assertMilestoneInput(Milestone.DELIVERED, {})).toThrow('Submission');
    expect(() => assertMilestoneInput(Milestone.DELIVERED, { mediaAssetId: 'a' })).not.toThrow();
    expect(() => assertMilestoneInput(Milestone.IN_PROGRESS, { mediaAssetId: 'a' })).toThrow('Only the DELIVERED');
  });
});
