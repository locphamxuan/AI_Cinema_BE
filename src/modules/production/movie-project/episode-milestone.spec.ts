import { BadRequestException } from '@nestjs/common';
import { isWithinMilestone, milestoneDay } from './episode-milestone';

describe('episode milestone', () => {
  const now = new Date('2026-10-02T09:00:00Z');

  it('accepts today and later, as a calendar day', () => {
    expect(milestoneDay('2026-10-02', now)).toEqual(new Date('2026-10-02'));
    expect(milestoneDay('2026-11-30', now)).toEqual(new Date('2026-11-30'));
  });

  it('refuses a day already past in Vietnam', () => {
    expect(() => milestoneDay('2026-10-01', now)).toThrow(BadRequestException);
    // 18:30 UTC is already the 3rd in Vietnam.
    expect(() => milestoneDay('2026-10-02', new Date('2026-10-02T18:30:00Z'))).toThrow(BadRequestException);
  });

  it('lets the studio be due on the milestone day but not after it', () => {
    const milestone = new Date('2026-11-30');
    expect(isWithinMilestone(new Date('2026-11-30'), milestone)).toBe(true);
    expect(isWithinMilestone(new Date('2026-12-01'), milestone)).toBe(false);
    expect(isWithinMilestone(new Date('2027-01-01'), null)).toBe(true);
  });
});
