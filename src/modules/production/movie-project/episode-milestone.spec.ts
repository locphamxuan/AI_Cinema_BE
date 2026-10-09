import { BadRequestException } from '@nestjs/common';
import { milestoneDay } from './episode-milestone';

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
});
