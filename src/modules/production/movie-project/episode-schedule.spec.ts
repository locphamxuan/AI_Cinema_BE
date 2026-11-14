import { BadRequestException } from '@nestjs/common';
import {
  assertExpectedRelease,
  assertReleaseWindow,
  deadlineDay,
  newEpisodeSchedule,
  optionalDay,
  seasonWindow,
} from './episode-schedule';

const day = (value: string) => new Date(value);

describe('episode schedule', () => {
  const now = new Date('2026-10-02T09:00:00Z');

  describe('deadlineDay', () => {
    it('accepts today and later, as a calendar day', () => {
      expect(deadlineDay('2026-10-02', now)).toEqual(day('2026-10-02'));
      expect(deadlineDay('2026-11-30', now)).toEqual(day('2026-11-30'));
    });

    it('refuses a day already past in Vietnam', () => {
      expect(() => deadlineDay('2026-10-01', now)).toThrow(BadRequestException);
      // 18:30 UTC is already the 3rd in Vietnam.
      expect(() => deadlineDay('2026-10-02', new Date('2026-10-02T18:30:00Z'))).toThrow(BadRequestException);
    });
  });

  it('optionalDay keeps undefined and null apart', () => {
    expect(optionalDay(undefined)).toBeUndefined();
    expect(optionalDay(null)).toBeNull();
    expect(optionalDay('2026-12-01')).toEqual(day('2026-12-01'));
  });

  describe('assertReleaseWindow', () => {
    it('accepts an open or ordered window', () => {
      expect(() => assertReleaseWindow({ releaseStartDate: null, releaseEndDate: day('2026-12-01') })).not.toThrow();
      expect(() =>
        assertReleaseWindow({ releaseStartDate: day('2026-12-01'), releaseEndDate: day('2026-12-01') }),
      ).not.toThrow();
    });

    it('refuses an end before the start', () => {
      expect(() =>
        assertReleaseWindow({ releaseStartDate: day('2026-12-02'), releaseEndDate: day('2026-12-01') }),
      ).toThrow(BadRequestException);
    });
  });

  it('seasonWindow and newEpisodeSchedule check what they build', () => {
    const window = seasonWindow({ releaseStartDate: '2026-12-01', releaseEndDate: '2026-12-31' });
    expect(window).toEqual({ releaseStartDate: day('2026-12-01'), releaseEndDate: day('2026-12-31') });
    expect(seasonWindow({})).toEqual({ releaseStartDate: null, releaseEndDate: null });
    expect(() => seasonWindow({ releaseStartDate: '2026-12-02', releaseEndDate: '2026-12-01' })).toThrow();

    expect(newEpisodeSchedule({ deliveryDeadline: '2026-11-30' }, window, now)).toEqual({
      deliveryDeadline: day('2026-11-30'),
      expectedReleaseDate: null,
    });
    expect(() =>
      newEpisodeSchedule({ deliveryDeadline: '2026-11-30', expectedReleaseDate: '2027-01-02' }, window, now),
    ).toThrow(BadRequestException);
  });

  describe('assertExpectedRelease', () => {
    const window = { releaseStartDate: day('2026-12-01'), releaseEndDate: day('2026-12-31') };

    it('accepts no date, or a date in the window after the deadline', () => {
      expect(() => assertExpectedRelease(null, day('2026-11-30'), window)).not.toThrow();
      expect(() => assertExpectedRelease(day('2026-12-10'), day('2026-11-30'), window)).not.toThrow();
      expect(() =>
        assertExpectedRelease(day('2027-01-05'), null, { releaseStartDate: null, releaseEndDate: null }),
      ).not.toThrow();
    });

    it('refuses a date before the delivery deadline', () => {
      expect(() => assertExpectedRelease(day('2026-12-05'), day('2026-12-06'), window)).toThrow(
        /before the delivery deadline/,
      );
    });

    it('refuses a date outside the season window', () => {
      expect(() => assertExpectedRelease(day('2026-11-30'), null, window)).toThrow(/release window/);
      expect(() => assertExpectedRelease(day('2027-01-01'), null, window)).toThrow(/release window/);
    });
  });
});
