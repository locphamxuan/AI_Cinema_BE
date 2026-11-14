import { BadRequestException } from '@nestjs/common';

/** Vietnam is UTC+7 all year (no daylight saving), so a business month starts at 17:00 UTC of the day before. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface PeriodRange {
  period: string;
  /** Inclusive start, midnight of the 1st in Vietnam. */
  from: Date;
  /** Exclusive end, midnight of the 1st of the next month in Vietnam. */
  to: Date;
}

/** "YYYY-MM" → the calendar month in Vietnam; an invalid period is a 400. */
export function periodRange(period: string): PeriodRange {
  const match = PERIOD.exec(period);
  if (!match) throw new BadRequestException('period must be YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return {
    period,
    from: new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS),
    to: new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS),
  };
}

/** The month in Vietnam that `now` falls in, as "YYYY-MM". */
export function periodOf(now: Date): string {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month before the one `now` falls in, in Vietnam. */
export function previousPeriod(now: Date): string {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return periodOf(new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() - 1, 15)));
}
