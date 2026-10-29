import type { Movie, MovieProject, Prisma } from '@prisma/client';

/** Include that reaches an episode's project through its catalog movie. */
export const WITH_PROJECT = { movie: { include: { project: true } } } satisfies Prisma.EpisodeInclude;

/** The episode with its project lifted next to its movie; every movie of an episode has its project (1:1). */
export function liftProject<E extends { movie: Movie & { project: MovieProject | null } }>(
  episode: E,
): E & { project: MovieProject } {
  const { project } = episode.movie;
  if (!project) throw new Error(`Movie ${episode.movie.id} has no project row`);
  return { ...episode, project };
}

/** A production row's project as lists show it: who owns it and the movie title. */
export const PROJECT_REF = {
  select: { id: true, reviewerId: true, creatorId: true, movie: { select: { title: true } } },
} satisfies Prisma.MovieProjectDefaultArgs;
