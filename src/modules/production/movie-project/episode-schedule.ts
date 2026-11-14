import { BadRequestException } from '@nestjs/common';
import { businessDay } from 'src/common/time/business-day';

/** A delivery deadline (YYYY-MM-DD) as a date column holds it; today in Vietnam is the earliest allowed. */
export function deadlineDay(value: string, now: Date = new Date()): Date {
  const day = new Date(value);
  if (day < businessDay(now)) throw new BadRequestException('A delivery deadline cannot be in the past');
  return day;
}

/** An optional calendar day (YYYY-MM-DD); null clears it, undefined leaves it unchanged. */
export function optionalDay(value: string | null | undefined): Date | null | undefined {
  return value === undefined || value === null ? value : new Date(value);
}

/** The day a PATCH sets: undefined keeps the stored one, null clears it. */
export function changedDay(value: string | null | undefined, current: Date | null): Date | null {
  const day = optionalDay(value);
  return day === undefined ? current : day;
}

export interface ReleaseWindow {
  releaseStartDate: Date | null;
  releaseEndDate: Date | null;
}

/** BR-60: a season is released from its start day to its end day. */
export function assertReleaseWindow({ releaseStartDate, releaseEndDate }: ReleaseWindow): void {
  if (releaseStartDate && releaseEndDate && releaseStartDate > releaseEndDate) {
    throw new BadRequestException('The release window of a season must start on or before its end');
  }
}

/** The release window of a new season, checked. */
export function seasonWindow(season: { releaseStartDate?: string | null; releaseEndDate?: string | null }) {
  const window: ReleaseWindow = {
    releaseStartDate: optionalDay(season.releaseStartDate) ?? null,
    releaseEndDate: optionalDay(season.releaseEndDate) ?? null,
  };
  assertReleaseWindow(window);
  return window;
}

/** The dates of a new episode, checked against its season's window. */
export function newEpisodeSchedule(
  episode: { deliveryDeadline: string; expectedReleaseDate?: string },
  window: ReleaseWindow,
  now: Date = new Date(),
) {
  const deliveryDeadline = deadlineDay(episode.deliveryDeadline, now);
  const expectedReleaseDate = optionalDay(episode.expectedReleaseDate) ?? null;
  assertExpectedRelease(expectedReleaseDate, deliveryDeadline, window);
  return { deliveryDeadline, expectedReleaseDate };
}

/**
 * BR-60: an episode is expected out within its season's window and never before its delivery deadline.
 * Checked here for a clear 400; the database enforces the same with a CHECK and a trigger.
 */
export function assertExpectedRelease(
  expected: Date | null | undefined,
  deadline: Date | null | undefined,
  window: ReleaseWindow,
): void {
  if (!expected) return;
  if (deadline && expected < deadline) {
    throw new BadRequestException('The expected release date cannot be before the delivery deadline');
  }
  const { releaseStartDate: start, releaseEndDate: end } = window;
  if ((start && expected < start) || (end && expected > end)) {
    throw new BadRequestException("The expected release date must lie within the season's release window");
  }
}
