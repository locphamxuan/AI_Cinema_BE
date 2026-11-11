import { ChangeRequestStatus, type MovieProject, type Prisma } from '@prisma/client';
import type { PaginateConfig, PaginateQuery } from '@nestarc/pagination';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';

export const PERSON = { select: { id: true, fullName: true, email: true } } as const;

export const OPEN_CHANGE_REQUESTS = {
  _count: { select: { changeRequests: { where: { status: ChangeRequestStatus.OPEN } } } },
} satisfies Prisma.MovieProjectInclude;

/** A row of the project list: its catalog face, people, studio and open change requests. */
export const LIST_ROW = {
  movie: { include: { _count: { select: { episodes: true } } } },
  reviewer: PERSON,
  creator: PERSON,
  studio: true,
  ...OPEN_CHANGE_REQUESTS,
} satisfies Prisma.MovieProjectInclude;

/** Sorting and filters every paged list of projects offers. */
export const PROJECT_PAGE: Pick<
  PaginateConfig<MovieProject>,
  'sortableColumns' | 'defaultSortBy' | 'filterableColumns'
> = {
  sortableColumns: ['status', 'createdAt', 'updatedAt'],
  defaultSortBy: [['updatedAt', 'DESC']],
  filterableColumns: { status: ['$eq', '$in'], creatorId: ['$eq'] },
};

/** The title lives on the catalog movie, out of reach of the paginator's own search. */
export function titledProjects(query: PaginateQuery): Prisma.MovieProjectWhereInput {
  return query.search ? { movie: { title: { contains: query.search, mode: 'insensitive' } } } : {};
}

/** The newest content event of each project: "Cập nhật lần cuối" counts every change, not only the project row. */
export async function lastActivityOf(prisma: PrismaService, projectIds: string[]): Promise<Map<string, Date>> {
  const latest = await prisma.auditLog.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds } },
    _max: { createdAt: true },
  });
  return new Map(
    latest.flatMap(({ projectId, _max }) => (projectId && _max.createdAt ? [[projectId, _max.createdAt]] : [])),
  );
}
