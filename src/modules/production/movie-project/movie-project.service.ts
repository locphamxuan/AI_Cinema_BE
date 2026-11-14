import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProjectStatus, Prisma, UserRole } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { CreateMovieProjectRequestDto } from './dto/create-movie-project.request.dto';
import { UpdateMovieProjectRequestDto } from './dto/update-movie-project.request.dto';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { revisionSummary } from './revision-summary';
import { resolveGenreIds } from './genre-resolver';
import { newEpisodeSchedule, seasonWindow } from './episode-schedule';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { lastActivityOf, LIST_ROW, OPEN_CHANGE_REQUESTS, PERSON, PROJECT_PAGE, titledProjects } from './project-list';

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
    private readonly costs: ProductionCostService,
    private readonly studios: StudioService,
    private readonly lifecycle: ProjectLifecycleService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** MF-1 step 1 (07/11/2026): the Admin creates the project, picks its Reviewer and assigns the lead Creator. */
  async create(dto: CreateMovieProjectRequestDto, user: AuthenticatedUser) {
    const studio = dto.studioId ? await this.studios.assertUsable(dto.studioId) : null;
    await this.lifecycle.assertActive(dto.reviewerId, UserRole.CONTENT_REVIEWER);
    if (dto.creatorId) await this.lifecycle.assertActive(dto.creatorId, UserRole.CONTENT_CREATOR);
    const seasons = (dto.seasons ?? []).map((season) => {
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
            create: { ideaDescription: dto.ideaDescription.trim(), studioId: dto.studioId, reviewerId: dto.reviewerId },
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
    await this.lifecycle.announceReviewer(projectId);
    if (dto.creatorId) await this.lifecycle.assignCreator(projectId, dto.creatorId, user);
    if (studio) await this.lifecycle.announceStudio(projectId, studio);
    return this.detail(projectId, user);
  }

  /** One row per project, its catalog fields alongside, with the open change requests (§4.1.8). */
  async list(query: PaginateQuery, user: AuthenticatedUser) {
    const readable = await this.access.readableWhere(user);
    const page = await paginate(query, this.prisma.movieProject, {
      where: { AND: [readable, titledProjects(query)] },
      relations: LIST_ROW,
      ...PROJECT_PAGE,
    });
    const lastActivity = await lastActivityOf(
      this.prisma,
      page.data.map((project) => project.id),
    );
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
      cost: await this.costs.summary(projectId),
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
      // MF-1 (12/11/2026): the Admin chooses the studio — at creation, on the Final Script, or by a studio change
      // after the hand-off. The Reviewer edits the project content only (and the Admin never edits it, BR-55).
      throw new ForbiddenException(
        'Only the Admin chooses the studio: at creation, on the Final Script or by a studio change',
      );
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
