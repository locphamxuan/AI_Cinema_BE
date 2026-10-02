import type { Actor, Row } from './api';

export interface ProjectDetail extends Row {
  status: string;
  seasons: { episodes: { id: string; episodeNumber: number; status: string }[] }[];
}

export const episodesOf = (project: ProjectDetail) => project.seasons.flatMap((season) => season.episodes);

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A funded project assigned to `creator`, with `episodes` episodes of 15 minutes in one season. */
export async function assignedProject(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const genreId = (await reviewer.get<{ data: Row[] }>('/genres?limit=1')).data[0].id;
  const project = await reviewer.post<ProjectDetail>('/projects', {
    title: `Dự án e2e ${Date.now()}`,
    ideaDescription: 'Một bộ phim trinh thám AI dùng cho bộ test end-to-end.',
    genreIds: [genreId],
    seasons: [
      {
        episodes: Array.from({ length: episodes }, (_, i) => ({ title: `Tập ${i + 1}`, targetDurationSeconds: 900 })),
      },
    ],
  });
  await reviewer.post(`/projects/${project.id}/fee/entries`, { entryType: 'INITIAL', amountTokens: 20000 });
  await reviewer.post(`/projects/${project.id}/assign`, { creatorId: creator.id }, 204);
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

/** The project above, handed off to a studio with deadlines in a week. */
export async function projectInProduction(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const project = await assignedProject(reviewer, creator, episodes);
  await creator.post(`/projects/${project.id}/handoff`, {
    studioName: 'Studio Ánh Trăng',
    studioEmail: 'contact@anhtrang.example',
    dueDates: episodesOf(project).map((episode) => ({ episodeId: episode.id, dueDate: inDays(7) })),
  });
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

export { inDays };
