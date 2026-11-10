import { randomUUID } from 'node:crypto';
import { SEED_USER_PASSWORD } from '../../prisma/seed-accounts';
import type { Actor, Row } from './api';
import { adminSign, proposeCost } from './contracts';

export interface ProjectDetail extends Row {
  status: string;
  studio: { id: string; name: string } | null;
  seasons: { id: string; status: string; episodes: { id: string; episodeNumber: number; status: string }[] }[];
}

export const episodesOf = (project: ProjectDetail) => project.seasons.flatMap((season) => season.episodes);

/** Budget (VND) the Admin sets on every project of the helpers below. */
export const PROJECT_BUDGET_VND = 100_000_000;
/** Cost (VND) the helpers' studios quote and the Admin signs. */
export const HANDOFF_FEE_VND = 40_000_000;
/** The body of a hand-off of the whole project at HANDOFF_FEE_VND (legacy Creator hand-off route). */
export const HANDOFF = { offeredFeeVnd: HANDOFF_FEE_VND };

const ADMIN_EMAIL = 'admin@aicinema.com';

/** The Admin sets the production budget of a project (BR-46). */
export async function fundProject(anyActor: Actor, projectId: string, amountVnd = PROJECT_BUDGET_VND): Promise<void> {
  const admin = await anyActor.signInAs(ADMIN_EMAIL);
  await admin.post(`/projects/${projectId}/costs/entries`, { entryType: 'BUDGET', amountVnd });
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A studio of the catalog (BR-59) with a unique email. */
export function newStudio(actor: Actor, name = 'Studio Ánh Trăng'): Promise<Row> {
  return actor.post('/studios', { name, email: `studio-${randomUUID()}@anhtrang.example` });
}

/** The Admin opens a login for the studio (MF-1, 07/11/2026) and signs in with it. */
export async function studioAccount(anyActor: Actor, studioId: string): Promise<Actor> {
  const admin = await anyActor.signInAs(ADMIN_EMAIL);
  const email = `login-${randomUUID()}@studio.example`;
  await admin.post(`/studios/${studioId}/accounts`, { email, fullName: 'Studio e2e', password: SEED_USER_PASSWORD });
  return admin.signInAs(email);
}

/**
 * The Admin creates a project with `reviewer` in charge, assigned to `creator`, funded with PROJECT_BUDGET_VND, with
 * `episodes` episodes of 15 minutes in one season (MF-1 step 1).
 */
export async function assignedProject(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const admin = await reviewer.signInAs(ADMIN_EMAIL);
  const genreId = (await reviewer.get<{ data: Row[] }>('/genres?limit=1')).data[0].id;
  const studio = await newStudio(admin);
  const project = await admin.post<ProjectDetail>('/projects', {
    title: `Dự án e2e ${Date.now()}`,
    ideaDescription: 'Một bộ phim trinh thám AI dùng cho bộ test end-to-end.',
    genreIds: [genreId],
    studioId: studio.id,
    reviewerId: reviewer.id,
    creatorId: creator.id,
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
  await fundProject(reviewer, project.id);
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

/** MF-1 §2: the Creator submits the script, the Reviewer and then the Admin approve it; the studio gets its contract. */
export async function finalScript(reviewer: Actor, creator: Actor, projectId: string): Promise<void> {
  const admin = await reviewer.signInAs(ADMIN_EMAIL);
  await creator.post(`/projects/${projectId}/script/versions`, { content: 'CẢNH 1 — NỘI. PHÒNG LAB — ĐÊM' });
  await reviewer.post(`/projects/${projectId}/script/review`, { approve: true });
  await admin.post(`/projects/${projectId}/script/final-review`, { approve: true });
}

/**
 * MF-1 §3–4 (10/11/2026): the studio quotes HANDOFF_FEE_VND and uploads its signed contract PDF, the Admin
 * uploads the AI Cinema counterpart: the round carries both signatures and the project is handed off.
 */
export async function signContract(reviewer: Actor, projectId: string, studio: Actor): Promise<void> {
  const admin = await reviewer.signInAs(ADMIN_EMAIL);
  const [template] = await admin.get<Row[]>(`/projects/${projectId}/contracts`);
  await proposeCost(studio, template.id, HANDOFF_FEE_VND);
  await adminSign(admin, template.id);
}

/** The studio account each project of projectInProduction signed with, by project id. */
const studios = new Map<string, Actor>();
/** The same studio accounts, by the id of each episode they deliver. */
const episodeStudios = new Map<string, Actor>();

/** The project above, through the Final Script and a signed contract: IN_PRODUCTION, its studio delivering. */
export async function projectInProduction(reviewer: Actor, creator: Actor, episodes = 2): Promise<ProjectDetail> {
  const project = await assignedProject(reviewer, creator, episodes);
  await finalScript(reviewer, creator, project.id);
  const studio = await studioAccount(reviewer, project.studio!.id);
  await signContract(reviewer, project.id, studio);
  studios.set(project.id, studio);
  for (const episode of episodesOf(project)) episodeStudios.set(episode.id, studio);
  return reviewer.get<ProjectDetail>(`/projects/${project.id}`);
}

/** The logged-in studio of a project made by projectInProduction. */
export const studioOf = (projectId: string): Actor => studios.get(projectId)!;

/** The logged-in studio that delivers an episode of a project made by projectInProduction. */
export const studioOfEpisode = (episodeId: string): Actor | undefined => episodeStudios.get(episodeId);

export { inDays };
