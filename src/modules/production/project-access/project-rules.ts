import { ConflictException } from '@nestjs/common';
import { EpisodeStatus, MovieStatus } from '@prisma/client';

/** A project can still be planned and changed until it is completed or cancelled. */
export const OPEN_PROJECT_STATUSES: MovieStatus[] = [
  MovieStatus.DRAFT,
  MovieStatus.ASSIGNED,
  MovieStatus.IN_PRODUCTION,
];

/**
 * The studio is working on the movie: deliveries, review, labels, compliance and releases happen
 * while it is IN_PRODUCTION, or UNDER_REVISION once a completed movie has episodes to fix (BR-56).
 */
export const DELIVERY_PROJECT_STATUSES: MovieStatus[] = [MovieStatus.IN_PRODUCTION, MovieStatus.UNDER_REVISION];

/** Before the Reviewer approves a delivery the studio can still be asked for another length (BR-31). */
export const EPISODE_STATUSES_BEFORE_APPROVAL: EpisodeStatus[] = [
  EpisodeStatus.DRAFT,
  EpisodeStatus.AWAITING_MEDIA,
  EpisodeStatus.PROCESSING,
  EpisodeStatus.IN_REVIEW,
  EpisodeStatus.CHANGES_REQUESTED,
];

export function assertProjectStatus(status: MovieStatus, allowed: MovieStatus[], action: string): void {
  if (!allowed.includes(status)) {
    throw new ConflictException(`Cannot ${action} while the project is ${status}`);
  }
}

export function assertEpisodeStatus(status: EpisodeStatus, allowed: EpisodeStatus[], action: string): void {
  if (!allowed.includes(status)) {
    throw new ConflictException(`Cannot ${action} while the episode is ${status}`);
  }
}

/** New episodes start waiting for the studio once the project was handed off. */
export function initialEpisodeStatus(movieStatus: MovieStatus): EpisodeStatus {
  return movieStatus === MovieStatus.IN_PRODUCTION ? EpisodeStatus.AWAITING_MEDIA : EpisodeStatus.DRAFT;
}
