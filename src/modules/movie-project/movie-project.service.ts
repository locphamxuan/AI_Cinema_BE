import { BadRequestException, Injectable } from '@nestjs/common';
import { ChangeRequestStatus, MovieStatus, Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { ProductionFeeService } from 'src/modules/production-fee/production-fee.service';
import { CreateMovieProjectRequestDto } from './dto/create-movie-project.request.dto';
import { UpdateMovieProjectRequestDto } from './dto/update-movie-project.request.dto';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/project-access/project-rules';

const PERSON = { select: { id: true, fullName: true, email: true } } as const;

const PROJECT_DETAIL = {
  genres: { include: { genre: true } },
  reviewer: PERSON,
  creator: PERSON,
  seasons: {
    orderBy: { seasonNumber: 'asc' },
    include: {
      episodes: {
        orderBy: { episodeNumber: 'asc' },
        include: {
          mediaAssets: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, version: true, ingestStatus: true, durationSeconds: true },
          },
        },
      },
    },
  },
  ideaFiles: { orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
  studioHandoffs: { orderBy: { createdAt: 'desc' }, include: { createdBy: PERSON } },
  _count: { select: { changeRequests: { where: { status: ChangeRequestStatus.OPEN } } } },
} satisfies Prisma.MovieInclude;

@Injectable()
export class MovieProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly fees: ProductionFeeService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Step 1: the project with its seasons and episodes, numbered across the whole movie (BR-03, BR-37). */
  async create(dto: CreateMovieProjectRequestDto, user: AuthenticatedUser) {
    await this.assertGenresExist(dto.genreIds);
    const movieId = await this.prisma.$transaction(async (tx) => {
      const movie = await tx.movie.create({
        data: {
          title: dto.title.trim(),
          ideaDescription: dto.ideaDescription.trim(),
          defaultLanguage: dto.defaultLanguage,
          reviewerId: user.id,
          genres: { create: dto.genreIds.map((genreId) => ({ genreId })) },
        },
      });
      let episodeNumber = 1;
      for (const [index, season] of dto.seasons.entries()) {
        const created = await tx.season.create({
          data: { movieId: movie.id, seasonNumber: index + 1, title: season.title },
        });
        await tx.episode.createMany({
          data: season.episodes.map((episode) => ({
            movieId: movie.id,
            seasonId: created.id,
            episodeNumber: episodeNumber++,
            title: episode.title.trim(),
            synopsis: episode.synopsis,
            targetDurationSeconds: episode.targetDurationSeconds,
          })),
        });
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_CREATED,
          entityType: 'Movie',
          entityId: movie.id,
          movieId: movie.id,
          actorId: user.id,
        },
        tx,
      );
      return movie.id;
    });
    return this.detail(movieId, user);
  }

  async list(query: PaginateQuery, user: AuthenticatedUser) {
    return paginate(query, this.prisma.movie, {
      where: await this.access.readableWhere(user),
      relations: { reviewer: PERSON, creator: PERSON, _count: { select: { episodes: true } } },
      sortableColumns: ['title', 'status', 'createdAt', 'updatedAt'],
      defaultSortBy: [['updatedAt', 'DESC']],
      searchableColumns: ['title', 'studioName'],
      filterableColumns: { status: ['$eq', '$in'], creatorId: ['$eq'] },
    });
  }

  async detail(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    const movie = await this.prisma.movie.findUniqueOrThrow({ where: { id: movieId }, include: PROJECT_DETAIL });
    const { _count, genres, ...rest } = movie;
    return {
      ...rest,
      genres: genres.map(({ genre }) => genre),
      productionFeeTokens: await this.fees.totalTokens(movieId),
      openChangeRequests: _count.changeRequests,
    };
  }

  async update(movieId: string, dto: UpdateMovieProjectRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, [...OPEN_PROJECT_STATUSES, MovieStatus.COMPLETED], 'edit the project');
    if (dto.genreIds) await this.assertGenresExist(dto.genreIds);

    const { genreIds, ...fields } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.movie.update({ where: { id: movieId }, data: fields });
      if (genreIds) await this.replaceGenres(tx, movieId, genreIds);
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_UPDATED,
          entityType: 'Movie',
          entityId: movieId,
          movieId,
          actorId: user.id,
          payload: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.detail(movieId, user);
  }

  async events(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    return this.auditLog.findForMovie(movieId);
  }

  private async replaceGenres(tx: PrismaTx, movieId: string, genreIds: string[]) {
    await tx.movieGenre.deleteMany({ where: { movieId } });
    await tx.movieGenre.createMany({ data: genreIds.map((genreId) => ({ movieId, genreId })) });
  }

  private async assertGenresExist(genreIds: string[]) {
    const found = await this.prisma.genre.count({ where: { id: { in: genreIds } } });
    if (found !== genreIds.length) throw new BadRequestException('One of the genres does not exist');
  }
}
