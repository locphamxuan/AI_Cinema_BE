import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { assignedProject, episodesOf, finalScript, signContract, studioAccount } from './support/projects';

interface PipelineRow extends Row {
  title: string;
  status: string;
  genres: { id: string; name: string }[];
  openChangeRequests: number;
  lastActivityAt: string;
  script: { status: string; currentVersion: number; latestVersionAt: string | null } | null;
  episodes: {
    id: string;
    episodeNumber: number;
    title: string;
    status: string;
    finalConfirmedAt: string | null;
    coinPrice: number | null;
  }[];
  contract: { id: string; status: string; round: number; costVnd: number | null; studio: { name: string } } | null;
}
interface Page {
  data: PipelineRow[];
  meta: { totalItems: number };
}

describe('Project pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let otherReviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let title: string;
  let project: Row & { studio: { id: string } | null };

  const rowOf = async (actor: Actor) => {
    const page = await actor.get<Page>(`/projects/pipeline?search=${encodeURIComponent(title)}`);
    return page.data.find((row) => row.id === project.id);
  };

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, otherReviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    title = `Pipeline ${randomUUID()}`;
    project = await assignedProject(reviewer, creator, 2);
    await reviewer.patch(`/projects/${project.id}`, { title });
  });

  afterAll(() => app.close());

  it('lists the project with its episodes, before any script or contract', async () => {
    const detail = await reviewer.get<Parameters<typeof episodesOf>[0]>(`/projects/${project.id}`);
    const row = (await rowOf(reviewer))!;
    expect(row).toMatchObject({ title, status: 'ASSIGNED', script: null, contract: null, openChangeRequests: 0 });
    expect(row.genres.length).toBeGreaterThan(0);
    expect(row.episodes.map((e) => [e.id, e.episodeNumber])).toEqual(episodesOf(detail).map((e, i) => [e.id, i + 1]));
    expect(row.episodes[0]).toMatchObject({ status: 'DRAFT', finalConfirmedAt: null, coinPrice: null });
    expect(row).not.toHaveProperty('movie');
    expect(row).not.toHaveProperty('contracts');
  });

  it('is scoped like GET /projects: the team and the Admin read it, another Reviewer does not', async () => {
    expect(await rowOf(creator)).toBeDefined();
    expect(await rowOf(admin)).toBeDefined();
    expect(await rowOf(otherReviewer)).toBeUndefined();
  });

  it('pages and filters like GET /projects, and is not read as a project id', async () => {
    const page = await reviewer.get<Page>(
      `/projects/pipeline?search=${encodeURIComponent(title)}&filter.status=$in:ASSIGNED&limit=1`,
    );
    expect(page.meta.totalItems).toBe(1);
    const none = await reviewer.get<Page>(
      `/projects/pipeline?search=${encodeURIComponent(title)}&filter.status=$eq:COMPLETED`,
    );
    expect(none.data).toEqual([]);
  });

  it('follows the script and the open contract round, and drops the contract once signed', async () => {
    await finalScript(reviewer, creator, project.id);
    let row = (await rowOf(admin))!;
    expect(row.script).toMatchObject({ status: 'FINAL', currentVersion: 1 });
    expect(row.script?.latestVersionAt).toEqual(expect.any(String));
    expect(row.contract).toMatchObject({ status: 'SENT', round: 1, costVnd: null });
    expect(row.contract?.studio.name).toEqual(expect.any(String));

    const studio = await studioAccount(admin, project.studio!.id);
    await signContract(reviewer, project.id, studio);
    row = (await rowOf(admin))!;
    expect(row).toMatchObject({ status: 'IN_PRODUCTION', contract: null });
    expect(row.episodes.every((e) => e.status === 'AWAITING_MEDIA')).toBe(true);
  });
});
