import { Injectable, NotFoundException } from '@nestjs/common';
import type { Episode } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import {
  assertEpisodeStatus,
  assertProjectStatus,
  EPISODE_STATUSES_BEFORE_APPROVAL,
  initialEpisodeStatus,
  OPEN_PROJECT_STATUSES,
} from 'src/modules/project-access/project-rules';
import type { NewEpisodeDto, NewSeasonDto } from './dto/create-movie-project.request.dto';
import type { UpdateEpisodeRequestDto } from './dto/project-actions.request.dto';

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
    return this.prisma.$transaction(async (tx) => {
      await this.lockMovie(tx, movieId);
      const last = await tx.season.aggregate({ where: { movieId }, _max: { seasonNumber: true } });
      const season = await tx.season.create({
        data: { movieId, seasonNumber: (last._max.seasonNumber ?? 0) + 1, title: dto.title },
      });
      await this.createEpisodes(tx, movieId, season.id, dto.episodes, initialEpisodeStatus(movie.status));
      return tx.season.findUniqueOrThrow({
        where: { id: season.id },
        include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
      });
    });
  }

  async addEpisode(seasonId: string, dto: NewEpisodeDto, user: AuthenticatedUser) {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId }, select: { movieId: true } });
    if (!season) throw new NotFoundException('Season not found');
    const movie = await this.access.movie(season.movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'add an episode');
    return this.prisma.$transaction(async (tx) => {
      await this.lockMovie(tx, movie.id);
      const [episode] = await this.createEpisodes(tx, movie.id, seasonId, [dto], initialEpisodeStatus(movie.status));
      return episode;
    });
  }

  async updateEpisode(episodeId: string, dto: UpdateEpisodeRequestDto, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(episode.movie.status, OPEN_PROJECT_STATUSES, 'edit an episode');
    if (dto.targetDurationSeconds !== undefined) {
      assertEpisodeStatus(episode.status, EPISODE_STATUSES_BEFORE_APPROVAL, 'change the target duration');
    }
    return this.prisma.episode.update({ where: { id: episodeId }, data: dto });
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
    status: ReturnType<typeof initialEpisodeStatus>,
  ) {
    const last = await tx.episode.aggregate({ where: { movieId }, _max: { episodeNumber: true } });
    let episodeNumber = (last._max.episodeNumber ?? 0) + 1;
    const created: Episode[] = [];
    for (const episode of episodes) {
      created.push(
        await tx.episode.create({
          data: {
            movieId,
            seasonId,
            episodeNumber: episodeNumber++,
            title: episode.title.trim(),
            synopsis: episode.synopsis,
            targetDurationSeconds: episode.targetDurationSeconds,
            status,
          },
        }),
      );
    }
    return created;
  }
}
