import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTRACT_DETAIL, OPEN_CONTRACT_STATUSES } from 'src/modules/production/contract/contract-rounds';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { lastActivityOf, LIST_ROW, PROJECT_PAGE, titledProjects } from './project-list';

/** A list row plus what the role dashboards derive their work from; every relation is one query, however long the page. */
const PIPELINE_ROW = {
  ...LIST_ROW,
  movie: {
    include: {
      _count: { select: { episodes: true } },
      genres: { include: { genre: { select: { id: true, name: true } } } },
      episodes: {
        orderBy: { episodeNumber: 'asc' },
        select: {
          id: true,
          episodeNumber: true,
          title: true,
          status: true,
          finalConfirmedAt: true,
          coinPrice: true,
          updatedAt: true,
        },
      },
    },
  },
  script: {
    select: {
      status: true,
      currentVersion: true,
      versions: { orderBy: { version: 'desc' }, take: 1, select: { createdAt: true } },
    },
  },
  // At most one round is being negotiated at a time.
  contracts: {
    where: { status: { in: OPEN_CONTRACT_STATUSES } },
    orderBy: { round: 'desc' },
    take: 1,
    include: CONTRACT_DETAIL,
  },
} satisfies Prisma.MovieProjectInclude;

type PipelineRow = Prisma.MovieProjectGetPayload<{ include: typeof PIPELINE_ROW }>;

function pipelineView(row: PipelineRow, lastActivityAt: Date | undefined) {
  const {
    movie: { _count: movieCount, genres, episodes, ...movie },
    _count,
    script,
    contracts,
    ...project
  } = row;
  return {
    ...movie,
    ...project,
    _count: { episodes: movieCount.episodes },
    openChangeRequests: _count.changeRequests,
    lastActivityAt: lastActivityAt ?? project.updatedAt,
    genres: genres.map(({ genre }) => genre),
    script: script && {
      status: script.status,
      currentVersion: script.currentVersion,
      latestVersionAt: script.versions[0]?.createdAt ?? null,
    },
    episodes,
    contract: contracts[0] ?? null,
  };
}

/**
 * Where each project stands, for the role dashboards: the same projects and paging as `GET /projects`, each with
 * its script, episodes and open contract round, so a dashboard reads one page instead of two requests per project.
 */
@Injectable()
export class ProjectPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(query: PaginateQuery, user: AuthenticatedUser) {
    const readable = await this.access.readableWhere(user);
    const page = await paginate(query, this.prisma.movieProject, {
      where: { AND: [readable, titledProjects(query)] },
      relations: PIPELINE_ROW,
      ...PROJECT_PAGE,
    });
    const rows = page.data as PipelineRow[];
    const lastActivity = await lastActivityOf(
      this.prisma,
      rows.map((row) => row.id),
    );
    return { ...page, data: rows.map((row) => pipelineView(row, lastActivity.get(row.id))) };
  }
}
