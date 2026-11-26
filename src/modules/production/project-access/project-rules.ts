import { ConflictException } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus } from '@prisma/client';

/** A project can still be planned and changed until it is completed or cancelled. */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.ASSIGNED,
  ProjectStatus.IN_PRODUCTION,
];

/**
 * The studio is working on the movie: deliveries, review, labels, compliance and releases happen
 * while it is IN_PRODUCTION, or UNDER_REVISION once a completed movie has episodes to fix (BR-56).
 */
export const DELIVERY_PROJECT_STATUSES: ProjectStatus[] = [ProjectStatus.IN_PRODUCTION, ProjectStatus.UNDER_REVISION];

/** Before the Reviewer approves a delivery the studio can still be asked for another length (BR-31). */
export const EPISODE_STATUSES_BEFORE_APPROVAL: EpisodeStatus[] = [
  EpisodeStatus.DRAFT,
  EpisodeStatus.AWAITING_MEDIA,
  EpisodeStatus.PROCESSING,
  EpisodeStatus.IN_REVIEW,
  EpisodeStatus.CHANGES_REQUESTED,
];

/** `details.reason` of a 409 for a step the project or episode status does not allow (stable for the clients). */
export const STATUS_REASON = {
  PROJECT: 'PROJECT_STATUS_NOT_ALLOWED',
  EPISODE: 'EPISODE_STATUS_NOT_ALLOWED',
  /** A concurrent request (double click, another user) changed the row first; the client reloads. */
  CHANGED_MEANWHILE: 'CHANGED_MEANWHILE',
} as const;

/** 409 for a conditional write that found the row already changed by a concurrent request. */
export function changedMeanwhile(message = 'The episode changed meanwhile; reload it'): ConflictException {
  return new ConflictException({ message, details: { reason: STATUS_REASON.CHANGED_MEANWHILE } });
}

export function assertProjectStatus(status: ProjectStatus, allowed: ProjectStatus[], action: string): void {
  if (!allowed.includes(status)) {
    throw new ConflictException({
      message: `Cannot ${action} while the project is ${status}`,
      details: { reason: STATUS_REASON.PROJECT, status, allowed },
    });
  }
}

export function assertEpisodeStatus(status: EpisodeStatus, allowed: EpisodeStatus[], action: string): void {
  if (!allowed.includes(status)) {
    throw new ConflictException({
      message: `Cannot ${action} while the episode is ${status}`,
      details: { reason: STATUS_REASON.EPISODE, status, allowed },
    });
  }
}

/** New episodes start waiting for the studio once the project was handed off. */
export function initialEpisodeStatus(movieStatus: ProjectStatus): EpisodeStatus {
  return movieStatus === ProjectStatus.IN_PRODUCTION ? EpisodeStatus.AWAITING_MEDIA : EpisodeStatus.DRAFT;
}
