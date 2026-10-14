import { randomUUID } from 'node:crypto';
import type { Actor, Row } from './api';

export interface ProjectDetail extends Row {
  status: string;
  studio: { id: string; name: string } | null;
  seasons: { id: string; episodes: { id: string; episodeNumber: number; status: string }[] }[];
}

export const episodesOf = (project: ProjectDetail) => project.seasons.flatMap((season) => season.episodes);

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A studio of the catalog (BR-59) with a unique email, kept by `reviewer`. */
export function newStudio(reviewer: Actor, name = 'Studio Ánh Trăng'): Promise<Row> {
  return reviewer.post('/studios', { name, email: `studio-${randomUUID()}@anhtrang.example` });
}

/** A funded project assigned to `creator`, with `episodes` episodes of 15 minutes in one season. */
export async function assignedProject(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const genreId = (await reviewer.get<{ data: Row[] }>('/genres?limit=1')).data[0].id;
  const studio = await newStudio(reviewer);
  const project = await reviewer.post<ProjectDetail>('/projects', {
    title: `Dự án e2e ${Date.now()}`,
    ideaDescription: 'Một bộ phim trinh thám AI dùng cho bộ test end-to-end.',
    genreIds: [genreId],
    studioId: studio.id,
    seasons: [
      {
        releaseStartDate: inDays(30),
        releaseEndDate: inDays(90),
        episodes: Array.from({ length: episodes }, (_, i) => ({
          title: `Tập ${i + 1}`,
          targetDurationSeconds: 900,
          deliveryDeadline: inDays(30),
          expectedReleaseDate: inDays(45 + i),
        })),
      },
    ],
  });
  await reviewer.post(`/projects/${project.id}/fee/entries`, { entryType: 'INITIAL', amountTokens: 20000 });
  await reviewer.post(`/projects/${project.id}/assign`, { creatorId: creator.id }, 204);
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

/** The project above, handed off to its studio, due on the Reviewer deadlines (30 days out). */
export async function projectInProduction(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const project = await assignedProject(reviewer, creator, episodes);
  await creator.post(`/projects/${project.id}/handoff`, {});
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

export { inDays };
