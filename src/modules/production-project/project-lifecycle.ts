import { ConflictException } from '@nestjs/common';
import { EpisodeProductionStatus, Prisma, ProductionProjectStatus } from '@prisma/client';

/**
 * Lifecycle of a production project: DRAFT until the Reviewer grants its first
 * quota, ACTIVE while episodes are produced, COMPLETED once every episode is
 * published. A CANCELLED or COMPLETED project takes no more production work.
 */
export const OPEN_PROJECT_STATUSES: ProductionProjectStatus[] = [
  ProductionProjectStatus.DRAFT,
  ProductionProjectStatus.ACTIVE,
];

export function assertProjectOpen(project: { status: ProductionProjectStatus }) {
  if (!OPEN_PROJECT_STATUSES.includes(project.status)) {
    throw new ConflictException(`The production project is ${project.status} and takes no more production work`);
  }
}

/** Production starts with the first quota: a DRAFT project becomes ACTIVE. */
export function activateProject(tx: Prisma.TransactionClient, projectId: string) {
  return tx.productionProject.updateMany({
    where: { id: projectId, status: ProductionProjectStatus.DRAFT },
    data: { status: ProductionProjectStatus.ACTIVE },
  });
}

/**
 * Re-evaluates completion after an episode of `movieId` was published or pulled:
 * the project is COMPLETED exactly while all of its episodes are published.
 */
export async function syncProjectCompletion(tx: Prisma.TransactionClient, movieId: string) {
  const project = await tx.productionProject.findUnique({ where: { movieId } });
  if (!project || project.status === ProductionProjectStatus.CANCELLED) return;

  const published = await tx.episode.count({
    where: { movieId, productionStatus: EpisodeProductionStatus.PUBLISHED },
  });
  const complete = published >= (project.episodeCount ?? 1);
  const status = complete ? ProductionProjectStatus.COMPLETED : ProductionProjectStatus.ACTIVE;
  if (project.status !== status) {
    await tx.productionProject.update({ where: { id: project.id }, data: { status } });
  }
}
