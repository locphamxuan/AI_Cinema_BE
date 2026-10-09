import { businessDay } from './business-day';

describe('businessDay', () => {
  it('is already the next day in Vietnam while UTC is still on the previous one', () => {
    // 2026-10-02 18:30 UTC = 2026-10-03 01:30 in Vietnam.
    expect(businessDay(new Date('2026-10-02T18:30:00Z'))).toEqual(new Date('2026-10-03'));
  });

  it('matches the UTC day later in the day', () => {
    expect(businessDay(new Date('2026-10-03T09:00:00Z'))).toEqual(new Date('2026-10-03'));
  });
});
