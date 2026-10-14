import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, type Episode } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import {
  assertEpisodeStatus,
  assertProjectStatus,
  EPISODE_STATUSES_BEFORE_APPROVAL,
  initialEpisodeStatus,
  OPEN_PROJECT_STATUSES,
} from 'src/modules/production/project-access/project-rules';
import type { NewEpisodeDto, NewSeasonDto } from '../dto/create-movie-project.request.dto';
import type { UpdateEpisodeRequestDto, UpdateSeasonRequestDto } from '../dto/project-actions.request.dto';
import {
  assertExpectedRelease,
  assertReleaseWindow,
  changedDay,
  deadlineDay,
  newEpisodeSchedule,
  seasonWindow,
  type ReleaseWindow,
} from '../episode-schedule';

/** Seasons and episodes of a project; numbering goes on where the movie left off (BR-37). */
@Injectable()
export class ProjectStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async addSeason(movieId: string, dto: NewSeasonDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'add a season');
    const window = seasonWindow(dto);
    return this.prisma.$transaction(async (tx) => {
      await this.lockMovie(tx, movieId);
      const last = await tx.season.aggregate({ where: { movieId }, _max: { seasonNumber: true } });
      const season = await tx.season.create({
        data: { movieId, seasonNumber: (last._max.seasonNumber ?? 0) + 1, title: dto.title, ...window },
      });
      await this.createEpisodes(tx, movieId, season.id, dto.episodes, window, initialEpisodeStatus(movie.status));
      return tx.season.findUniqueOrThrow({
        where: { id: season.id },
        include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
      });
    });
  }

  /** Title and release window; the window must still hold the expected release date of every episode (BR-60). */
  async updateSeason(seasonId: string, dto: UpdateSeasonRequestDto, user: AuthenticatedUser) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      include: { episodes: { select: { episodeNumber: true, expectedReleaseDate: true } } },
    });
    if (!season) throw new NotFoundException('Season not found');
    const movie = await this.access.movie(season.movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'edit a season');

    const window: ReleaseWindow = {
      releaseStartDate: changedDay(dto.releaseStartDate, season.releaseStartDate),
      releaseEndDate: changedDay(dto.releaseEndDate, season.releaseEndDate),
    };
    assertReleaseWindow(window);
    for (const episode of season.episodes) {
      try {
        assertExpectedRelease(episode.expectedReleaseDate, null, window);
      } catch {
        throw new BadRequestException(
          `Episode ${episode.episodeNumber} is expected outside the new release window; move it first`,
        );
      }
    }
    return this.prisma.season.update({ where: { id: seasonId }, data: { title: dto.title, ...window } });
  }

  async addEpisode(seasonId: string, dto: NewEpisodeDto, user: AuthenticatedUser) {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new NotFoundException('Season not found');
    const movie = await this.access.movie(season.movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'add an episode');
    return this.prisma.$transaction(async (tx) => {
      await this.lockMovie(tx, movie.id);
      const [episode] = await this.createEpisodes(
        tx,
        movie.id,
        seasonId,
        [dto],
        season,
        initialEpisodeStatus(movie.status),
      );
      return episode;
    });
  }

  async updateEpisode(episodeId: string, dto: UpdateEpisodeRequestDto, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(episode.movie.status, OPEN_PROJECT_STATUSES, 'edit an episode');
    if (dto.targetDurationSeconds !== undefined) {
      assertEpisodeStatus(episode.status, EPISODE_STATUSES_BEFORE_APPROVAL, 'change the target duration');
    }
    const { deliveryDeadline, expectedReleaseDate, ...fields } = dto;
    const schedule = await this.scheduleChange(episode, deliveryDeadline, expectedReleaseDate);
    return this.prisma.episode.update({ where: { id: episodeId }, data: { ...fields, ...schedule } });
  }

  /**
   * Dates an edit changes. A moved deadline is also the studio due date once handed off: one deadline per
   * episode (BR-38). The expected release date must stay in the season window and after the deadline (BR-60).
   */
  private async scheduleChange(episode: Episode, deadlineValue?: string, releaseValue?: string | null) {
    if (deadlineValue === undefined && releaseValue === undefined) return {};
    let deadline = episode.deliveryDeadline;
    if (deadlineValue !== undefined) {
      assertEpisodeStatus(episode.status, EPISODE_STATUSES_BEFORE_APPROVAL, 'move the deadline');
      deadline = deadlineDay(deadlineValue);
    }
    const expected = changedDay(releaseValue, episode.expectedReleaseDate);
    const season = await this.prisma.season.findUniqueOrThrow({ where: { id: episode.seasonId } });
    assertExpectedRelease(expected, deadline, season);
    return {
      ...(deadlineValue === undefined
        ? {}
        : { deliveryDeadline: deadline, ...(episode.dueDate ? { dueDate: deadline } : {}) }),
      ...(releaseValue === undefined ? {} : { expectedReleaseDate: expected }),
    };
  }

  /** Episode numbers are unique per movie, so concurrent additions are serialised on the movie row. */
  private async lockMovie(tx: PrismaTx, movieId: string) {
    await tx.$queryRaw`SELECT id FROM movies WHERE id = ${movieId}::uuid FOR UPDATE`;
  }

  private async createEpisodes(
    tx: PrismaTx,
    movieId: string,
    seasonId: string,
    episodes: NewEpisodeDto[],
    window: ReleaseWindow,
    status: ReturnType<typeof initialEpisodeStatus>,
  ) {
    const last = await tx.episode.aggregate({ where: { movieId }, _max: { episodeNumber: true } });
    let episodeNumber = (last._max.episodeNumber ?? 0) + 1;
    const created: Episode[] = [];
    for (const episode of episodes) {
      const { deliveryDeadline, expectedReleaseDate } = newEpisodeSchedule(episode, window);
      created.push(
        await tx.episode.create({
          data: {
            movieId,
            seasonId,
            episodeNumber: episodeNumber++,
            title: episode.title.trim(),
            synopsis: episode.synopsis,
            targetDurationSeconds: episode.targetDurationSeconds,
            deliveryDeadline,
            expectedReleaseDate,
            // Added after the hand-off: the studio is due on the deadline right away.
            ...(status === EpisodeStatus.AWAITING_MEDIA ? { dueDate: deliveryDeadline } : {}),
            status,
          },
        }),
      );
    }
    return created;
  }
}
