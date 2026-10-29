import { ConflictException, Injectable } from '@nestjs/common';
import { ChangeRequestStatus, ProjectStatus, Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import { CreateMovieProjectRequestDto } from './dto/create-movie-project.request.dto';
import { UpdateMovieProjectRequestDto } from './dto/update-movie-project.request.dto';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { revisionSummary } from './revision-summary';
import { resolveGenreIds } from './genre-resolver';
import { newEpisodeSchedule, seasonWindow } from './episode-schedule';
import { StudioService } from 'src/modules/production/studio/studio.service';

const PERSON = { select: { id: true, fullName: true, email: true } } as const;

const OPEN_CHANGE_REQUESTS = {
  _count: { select: { changeRequests: { where: { status: ChangeRequestStatus.OPEN } } } },
} satisfies Prisma.MovieProjectInclude;

const PROJECT_DETAIL = {
  movie: {
    include: {
      genres: { include: { genre: true } },
      seasons: {
        orderBy: { seasonNumber: 'asc' },
        include: {
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            include: {
              assignedCreator: PERSON,
              mediaAssets: {
                orderBy: { version: 'desc' },
                take: 1,
                select: { id: true, version: true, ingestStatus: true, durationSeconds: true },
              },
            },
          },
        },
      },
    },
  },
  reviewer: PERSON,
  creator: PERSON,
  ideaFiles: { orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
  creatorAssignments: {
    where: { isActive: true },
    orderBy: { assignedAt: 'asc' },
    include: { creator: PERSON, delegatedFrom: PERSON },
  },
  studio: true,
  studioHandoffs: {
    orderBy: { createdAt: 'desc' },
    // The email status tells whether a studio change would cost the old studio's fee (BR-59).
    include: { createdBy: PERSON, studio: true, emailMessage: { select: { status: true } } },
  },
  ...OPEN_CHANGE_REQUESTS,
} satisfies Prisma.MovieProjectInclude;

/** A row of the project list: its catalog face, people, studio and open change requests. */
const LIST_ROW = {
  movie: { include: { _count: { select: { episodes: true } } } },
  reviewer: PERSON,
  creator: PERSON,
  studio: true,
  ...OPEN_CHANGE_REQUESTS,
} satisfies Prisma.MovieProjectInclude;
type ListRow = Prisma.MovieProjectGetPayload<{ include: typeof LIST_ROW }>;

/** Fields of an update that the catalog shows; the others belong to the project row. */
const MOVIE_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'synopsis',
  'defaultLanguage',
  'ageRating',
  'releaseYear',
  'freeEpisodeCount',
]);

function splitUpdate(fields: Omit<UpdateMovieProjectRequestDto, 'genreIds' | 'genreNames'>) {
  const entries = Object.entries(fields);
  return {
    movie: Object.fromEntries(entries.filter(([key]) => MOVIE_FIELDS.has(key))) as Prisma.MovieUpdateInput,
    project: Object.fromEntries(
      entries.filter(([key]) => !MOVIE_FIELDS.has(key)),
    ) as Prisma.MovieProjectUncheckedUpdateInput,
  };
}

@Injectable()
export class MovieProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly fees: ProductionFeeService,
    private readonly studios: StudioService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Step 1: the project with its seasons and episodes, numbered across the whole movie (BR-03, BR-37). */
  async create(dto: CreateMovieProjectRequestDto, user: AuthenticatedUser) {
    if (dto.studioId) await this.studios.assertUsable(dto.studioId);
    const seasons = dto.seasons.map((season) => {
      const window = seasonWindow(season);
      return {
        season,
        window,
        episodes: season.episodes.map((episode) => ({ episode, ...newEpisodeSchedule(episode, window) })),
      };
    });
    const projectId = await this.prisma.$transaction(async (tx) => {
      const genreIds = await resolveGenreIds(tx, dto.genreIds, dto.genreNames);
      const movie = await tx.movie.create({
        data: {
          title: dto.title.trim(),
          synopsis: dto.synopsis?.trim() || undefined,
          releaseYear: dto.releaseYear,
          ageRating: dto.ageRating,
          defaultLanguage: dto.defaultLanguage,
          genres: { create: genreIds.map((genreId) => ({ genreId })) },
          project: {
            create: { ideaDescription: dto.ideaDescription.trim(), studioId: dto.studioId, reviewerId: user.id },
          },
        },
      });
      let episodeNumber = 1;
      for (const [index, { season, window, episodes }] of seasons.entries()) {
        const created = await tx.season.create({
          data: {
            movieId: movie.id,
            seasonNumber: index + 1,
            title: season.title,
            episodeProductionCost: BigInt(season.episodeProductionCost),
            ...window,
          },
        });
        await tx.episode.createMany({
          data: episodes.map(({ episode, deliveryDeadline, expectedReleaseDate }) => ({
            movieId: movie.id,
            seasonId: created.id,
            episodeNumber: episodeNumber++,
            title: episode.title.trim(),
            synopsis: episode.synopsis,
            targetDurationSeconds: episode.targetDurationSeconds,
            deliveryDeadline,
            expectedReleaseDate,
          })),
        });
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_CREATED,
          entityType: 'MovieProject',
          entityId: movie.id,
          projectId: movie.id,
          actorId: user.id,
        },
        tx,
      );
      return movie.id;
    });
    return this.detail(projectId, user);
  }

  /** One row per project, its catalog fields alongside, with the open change requests (§4.1.8). */
  async list(query: PaginateQuery, user: AuthenticatedUser) {
    const readable = await this.access.readableWhere(user);
    // The title lives on the catalog movie, out of reach of the paginator's own search.
    const titled: Prisma.MovieProjectWhereInput = query.search
      ? { movie: { title: { contains: query.search, mode: 'insensitive' } } }
      : {};
    const page = await paginate(query, this.prisma.movieProject, {
      where: { AND: [readable, titled] },
      relations: LIST_ROW,
      sortableColumns: ['status', 'createdAt', 'updatedAt'],
      defaultSortBy: [['updatedAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'], creatorId: ['$eq'] },
    });
    const lastActivity = await this.lastActivity(page.data.map((project) => project.id));
    return {
      ...page,
      data: (page.data as ListRow[]).map(({ movie: { _count: movieCount, ...movie }, _count, ...project }) => ({
        ...movie,
        ...project,
        _count: { episodes: movieCount.episodes },
        openChangeRequests: _count.changeRequests,
        lastActivityAt: lastActivity.get(project.id) ?? project.updatedAt,
      })),
    };
  }

  /** The newest content event of each project: "Cập nhật lần cuối" counts every change, not only the project row. */
  private async lastActivity(projectIds: string[]): Promise<Map<string, Date>> {
    const latest = await this.prisma.auditLog.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds } },
      _max: { createdAt: true },
    });
    return new Map(
      latest.flatMap(({ projectId, _max }) => (projectId && _max.createdAt ? [[projectId, _max.createdAt]] : [])),
    );
  }

  /** The project with its catalog fields flattened in, as the production screens read it. */
  async detail(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    const project = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      include: PROJECT_DETAIL,
    });
    const {
      _count,
      movie: { genres, ...movie },
      ...rest
    } = project;
    return {
      ...movie,
      ...rest,
      genres: genres.map(({ genre }) => genre),
      productionFeeTokens: await this.fees.totalTokens(projectId),
      seasonFees: await this.fees.seasonFees(projectId),
      openChangeRequests: _count.changeRequests,
      revision: revisionSummary(movie.seasons),
    };
  }

  async update(projectId: string, dto: UpdateMovieProjectRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(
      project.status,
      [...OPEN_PROJECT_STATUSES, ProjectStatus.COMPLETED, ProjectStatus.UNDER_REVISION],
      'edit the project',
    );
    if (dto.studioId && dto.studioId !== project.studioId) {
      if (project.handedOffAt) throw new ConflictException('The project was handed off; change the studio there');
      await this.studios.assertUsable(dto.studioId);
    }

    const { genreIds, genreNames, ...fields } = dto;
    const changes = splitUpdate(fields);
    await this.prisma.$transaction(async (tx) => {
      await tx.movieProject.update({ where: { id: projectId }, data: changes.project });
      await tx.movie.update({ where: { id: projectId }, data: changes.movie });
      if (genreIds || genreNames)
        await this.replaceGenres(tx, projectId, await resolveGenreIds(tx, genreIds, genreNames));
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_UPDATED,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: user.id,
          payload: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.detail(projectId, user);
  }

  async events(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.auditLog.findForProject(projectId);
  }

  private async replaceGenres(tx: PrismaTx, movieId: string, genreIds: string[]) {
    await tx.movieGenre.deleteMany({ where: { movieId } });
    await tx.movieGenre.createMany({ data: genreIds.map((genreId) => ({ movieId, genreId })) });
  }
}
