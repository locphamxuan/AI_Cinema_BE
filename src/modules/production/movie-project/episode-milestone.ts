import { BadRequestException } from '@nestjs/common';
import { businessDay } from 'src/common/time/business-day';

/** A Reviewer milestone (YYYY-MM-DD) as a date column holds it; today in Vietnam is the earliest allowed. */
export function milestoneDay(value: string, now: Date = new Date()): Date {
  const day = new Date(value);
  if (day < businessDay(now)) throw new BadRequestException('A milestone cannot be in the past');
  return day;
}
