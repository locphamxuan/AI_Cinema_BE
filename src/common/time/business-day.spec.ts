import { businessDate, businessDay, startOfBusinessDay } from './business-day';

describe('businessDay', () => {
  it('is already the next day in Vietnam while UTC is still on the previous one', () => {
    // 2026-10-02 18:30 UTC = 2026-10-03 01:30 in Vietnam.
    expect(businessDay(new Date('2026-10-02T18:30:00Z'))).toEqual(new Date('2026-10-03'));
  });

  it('matches the UTC day later in the day', () => {
    expect(businessDay(new Date('2026-10-03T09:00:00Z'))).toEqual(new Date('2026-10-03'));
  });
});

describe('businessDate', () => {
  it('prints the Vietnam date, not the UTC one', () => {
    expect(businessDate(new Date('2026-11-30T20:00:00Z'))).toBe('2026-12-01');
    expect(businessDate(new Date('2026-11-30T10:00:00Z'))).toBe('2026-11-30');
  });
});

describe('startOfBusinessDay', () => {
  it('is midnight in Vietnam, 17:00 UTC of the day before', () => {
    expect(startOfBusinessDay(new Date('2026-10-02T18:30:00Z'))).toEqual(new Date('2026-10-02T17:00:00Z'));
    expect(startOfBusinessDay(new Date('2026-10-03T09:00:00Z'))).toEqual(new Date('2026-10-02T17:00:00Z'));
  });
});
