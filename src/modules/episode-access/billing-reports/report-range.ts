/** Reports are asked for over a range; a missing bound falls back to the last 30 days. */
const DEFAULT_WINDOW_DAYS = 30;

/** A date with no time part: read as a whole calendar day in Vietnam (UTC+7, no daylight saving). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRange {
  from: Date;
  /** Inclusive end; the reports filter with `lte`. */
  to: Date;
}

/**
 * The range both billing reports read. A date-only bound is a Vietnam business day, matching how
 * the revenue chart buckets its days: `from` starts at 00:00 and `to` ends at 23:59:59.999 of that
 * day in Vietnam. A bound with a time part is taken as the exact instant it names.
 */
export function reportRangeOf(from?: string, to?: string, now: Date = new Date()): ReportRange {
  return {
    from: from
      ? DATE_ONLY.test(from)
        ? new Date(`${from}T00:00:00.000+07:00`)
        : new Date(from)
      : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000),
    to: to ? (DATE_ONLY.test(to) ? new Date(`${to}T23:59:59.999+07:00`) : new Date(to)) : now,
  };
}
