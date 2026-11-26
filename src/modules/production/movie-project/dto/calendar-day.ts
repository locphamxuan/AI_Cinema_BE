import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsDateString, Matches } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day of the Vietnam business calendar, "YYYY-MM-DD" only (BR-38, BR-60). A timestamp is refused: its
 * UTC date can be the day before the one the user picked, and the deadline would move silently.
 */
export const IsCalendarDay = () =>
  applyDecorators(
    Trim(),
    IsDateString({ strict: true }, { message: '$property must be a date (YYYY-MM-DD)' }),
    Matches(CALENDAR_DAY, { message: '$property must be a calendar day (YYYY-MM-DD), without a time' }),
  );

/** Trims every string of a list (genre names), so a blank entry fails MinLength like an empty one. */
export const TrimEach = () =>
  Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((item: unknown) => (typeof item === 'string' ? item.trim() : item)) : value,
  );
