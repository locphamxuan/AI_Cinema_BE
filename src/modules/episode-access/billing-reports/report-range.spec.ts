import { reportRangeOf } from './report-range';

describe('reportRangeOf', () => {
  const now = new Date('2026-11-16T05:00:00.000Z');

  it('reads date-only bounds as whole Vietnam days, the end day included', () => {
    expect(reportRangeOf('2026-10-01', '2026-10-31', now)).toEqual({
      from: new Date('2026-09-30T17:00:00.000Z'),
      to: new Date('2026-10-31T16:59:59.999Z'),
    });
  });

  it('covers the full first and last Vietnam day for a one-day range', () => {
    const { from, to } = reportRangeOf('2026-10-05', '2026-10-05', now);

    // 00:30 and 23:30 on 05/10 in Vietnam both fall inside.
    expect(new Date('2026-10-04T17:30:00Z') >= from).toBe(true);
    expect(new Date('2026-10-05T16:30:00Z') <= to).toBe(true);
    // 23:30 on 04/10 and 00:30 on 06/10 do not.
    expect(new Date('2026-10-04T16:30:00Z') < from).toBe(true);
    expect(new Date('2026-10-05T17:30:00Z') > to).toBe(true);
  });

  it('keeps a bound that names an exact instant', () => {
    expect(reportRangeOf('2026-10-01T08:00:00Z', '2026-10-02T09:30:00+07:00', now)).toEqual({
      from: new Date('2026-10-01T08:00:00Z'),
      to: new Date('2026-10-02T02:30:00Z'),
    });
  });

  it('falls back to the last 30 days ending now', () => {
    expect(reportRangeOf(undefined, undefined, now)).toEqual({
      from: new Date('2026-10-17T05:00:00.000Z'),
      to: now,
    });
  });
});
