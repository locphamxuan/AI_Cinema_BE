import { BadRequestException } from '@nestjs/common';
import { ProductionContentType } from '@prisma/client';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';

/** Pure validation of a project's episodes, milestones and dates (no database access). */

export interface PlannedEpisode {
  seasonNumber: number;
  seasonEpisodeNumber: number;
  allottedDurationSeconds: number | null;
}

function resolveEpisodeCount(contentType: ProductionContentType, episodeCount?: number): number {
  if (contentType === ProductionContentType.SERIES) {
    if (episodeCount === undefined) {
      throw new BadRequestException('episodeCount is required for contentType SERIES');
    }
    return episodeCount;
  }
  return episodeCount ?? 1;
}

/**
 * The episodes to create a plan for, in order. `episodes` gives each one's
 * season and allotted duration (seasons may differ in size); without it the
 * project gets `episodeCount` episodes in a single season.
 */
export function resolveEpisodes(dto: CreateProductionProjectRequestDto): PlannedEpisode[] {
  if (!dto.episodes) {
    const count = resolveEpisodeCount(dto.contentType, dto.episodeCount);
    return Array.from({ length: count }, (_, i) => ({
      seasonNumber: 1,
      seasonEpisodeNumber: i + 1,
      allottedDurationSeconds: dto.defaultEpisodeDurationSeconds ?? null,
    }));
  }

  if (dto.episodeCount !== undefined && dto.episodeCount !== dto.episodes.length) {
    throw new BadRequestException(
      `episodeCount (${dto.episodeCount}) does not match the ${dto.episodes.length} episodes given`,
    );
  }
  const seasons = [...new Set(dto.episodes.map((e) => e.seasonNumber))].sort((a, b) => a - b);
  if (seasons.some((season, i) => season !== i + 1)) {
    throw new BadRequestException('Seasons must be numbered 1, 2, 3… without gaps');
  }
  if (dto.contentType === ProductionContentType.MOVIE && seasons.length > 1) {
    throw new BadRequestException('A MOVIE has a single season');
  }
  const cap = dto.defaultEpisodeDurationSeconds;
  if (cap !== undefined && dto.episodes.some((e) => e.targetDurationSeconds > cap)) {
    throw new BadRequestException(`No episode may exceed defaultEpisodeDurationSeconds (${cap}s)`);
  }

  // Season by season, keeping the given order inside each season.
  const episodes = dto.episodes;
  return seasons.flatMap((seasonNumber) =>
    episodes
      .filter((e) => e.seasonNumber === seasonNumber)
      .map((e, i) => ({
        seasonNumber,
        seasonEpisodeNumber: i + 1,
        allottedDurationSeconds: e.targetDurationSeconds,
      })),
  );
}

export function longestAllotted(episodes: PlannedEpisode[]): number | null {
  const durations = episodes.map((e) => e.allottedDurationSeconds).filter((d): d is number => d !== null);
  return durations.length > 0 ? Math.max(...durations) : null;
}

export function assertMilestones(milestones: { title?: string; startDate?: string; targetDate?: string }[]) {
  for (const milestone of milestones) {
    if (milestone.startDate && milestone.targetDate && new Date(milestone.startDate) > new Date(milestone.targetDate)) {
      throw new BadRequestException(
        `Milestone "${milestone.title ?? ''}" startDate must be on or before its targetDate`,
      );
    }
  }
}

export function ensureReleaseFlow(deadline: string, plannedReleaseDate: string) {
  if (new Date(plannedReleaseDate) < new Date(deadline)) {
    throw new BadRequestException('plannedReleaseDate must be on or after the deadline');
  }
}

export function ensureProductionStart(productionStartDate: string, deadline: string) {
  if (new Date(productionStartDate) >= new Date(deadline)) {
    throw new BadRequestException('productionStartDate must be before the deadline');
  }
}
