import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { deliver } from './support/media';
import { assignedProject, episodesOf, type ProjectDetail } from './support/projects';

interface Seat {
  creatorId: string;
  isLead: boolean;
  isActive: boolean;
  delegatedFromId: string | null;
  episodes: { id: string }[];
}

describe('Project team of Creators (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let lead: Actor;
  let second: Actor;
  let outsider: Actor;
  let project: ProjectDetail;

  const team = (as: Actor = reviewer) => as.get<Seat[]>(`/projects/${project.id}/creators`);

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, lead, second, outsider] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'creator02@aicinema.com'),
      signIn(app, 'creator03@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, lead, 3);
  });

  afterAll(() => app.close());

  it('lists the active Creators to Reviewers and Creators, and nobody else', async () => {
    const directory = await lead.get<Row[]>('/creators');
    expect(directory.map((c) => c.id)).toEqual(expect.arrayContaining([lead.id, second.id]));
    expect(directory.every((c) => !('passwordHash' in c))).toBe(true);
    await reviewer.get('/creators');
    const member = await signIn(app, 'member01@aicinema.com');
    await member.get('/creators', 403);
  });

  it('seats the lead Creator when the project is assigned', async () => {
    const seats = await team();
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ creatorId: lead.id, isLead: true, isActive: true });
    await outsider.get(`/projects/${project.id}/creators`, 404);
  });

  it('adds a Creator next to the lead, who then reads and works on the project', async () => {
    await second.get(`/projects/${project.id}`, 404);
    await lead.post(`/projects/${project.id}/creators`, { creatorId: second.id }, 403);
    await reviewer.post(`/projects/${project.id}/creators`, { creatorId: reviewer.id }, 400);
    await reviewer.post(`/projects/${project.id}/creators`, { creatorId: second.id });
    expect((await team()).map((s) => s.creatorId)).toEqual([lead.id, second.id]);

    await second.get(`/projects/${project.id}`);
    const list = await second.get<{ data: Row[] }>('/projects?limit=100');
    expect(list.data.map((p) => p.id)).toContain(project.id);
    const bell = await second.get<{ data: { type: string }[] }>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('PROJECT_ASSIGNED');
  });

  it('gives an episode to one Creator; only that Creator or the lead works on it', async () => {
    const [first, other] = episodesOf(project);
    await outsider.put(`/episodes/${first.id}/assignee`, { creatorId: second.id }, 404);
    await reviewer.put(`/episodes/${first.id}/assignee`, { creatorId: outsider.id }, 400);
    await reviewer.put(`/episodes/${first.id}/assignee`, { creatorId: second.id });
    expect((await team()).find((s) => s.creatorId === second.id)?.episodes.map((e) => e.id)).toEqual([first.id]);

    await reviewer.post(`/projects/${project.id}/handoff`, {}, 403);
    // Only the lead speaks to the studio; the other Creators are CC'd and pass their episodes up.
    await second.post(`/projects/${project.id}/handoff`, {}, 403);
    await lead.post(`/projects/${project.id}/handoff`, {});
    // The assignee delivers their episode; an episode nobody holds belongs to the lead.
    await deliver(second, first.id);
    await deliver(second, other.id, 403);
    // Given to the second Creator, it stays open to the lead as well.
    await reviewer.put(`/episodes/${other.id}/assignee`, { creatorId: second.id });
    await deliver(lead, other.id);
    // An episode held by the lead is closed to the other Creators.
    const third = episodesOf(project)[2];
    await reviewer.put(`/episodes/${third.id}/assignee`, { creatorId: lead.id });
    await deliver(second, third.id, 403);
  });

  it('rolls the season status up from its episodes', async () => {
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail.seasons[0].status).toBe('IN_PRODUCTION');
  });

  it('delegates episodes from one Creator to another, remembering who delegated', async () => {
    const [first] = episodesOf(project);
    await outsider.post(`/projects/${project.id}/delegations`, { toCreatorId: second.id, episodeIds: [first.id] }, 404);
    await second.post(`/projects/${project.id}/delegations`, { toCreatorId: second.id, episodeIds: [first.id] }, 400);
    const third = episodesOf(project)[2];
    // An episode the lead holds is not the second Creator's to delegate.
    await second.post(`/projects/${project.id}/delegations`, { toCreatorId: outsider.id, episodeIds: [third.id] }, 403);

    const seats = await second.post<Seat[]>(`/projects/${project.id}/delegations`, {
      toCreatorId: outsider.id,
      episodeIds: [first.id],
      note: 'Nghỉ phép hai tuần.',
    });
    const seat = seats.find((s) => s.creatorId === outsider.id);
    expect(seat).toMatchObject({ delegatedFromId: second.id, isActive: true });
    expect(seat?.episodes.map((e) => e.id)).toEqual([first.id]);
    await outsider.get(`/projects/${project.id}`);
  });

  it('removes a Creator, who loses access and returns their episodes; the lead cannot be removed', async () => {
    const [first] = episodesOf(project);
    await reviewer.call('delete', `/projects/${project.id}/creators/${lead.id}`, undefined, 409);
    await reviewer.call('delete', `/projects/${project.id}/creators/${outsider.id}`, undefined, 200);
    await outsider.get(`/projects/${project.id}`, 404);
    const episode = await app.get(PrismaService).episode.findUniqueOrThrow({ where: { id: first.id } });
    expect(episode.assignedCreatorId).toBeNull();
    await reviewer.call('delete', `/projects/${project.id}/creators/${outsider.id}`, undefined, 400);
    const seats = await team();
    expect(seats.filter((s) => s.isActive).map((s) => s.creatorId)).toEqual([lead.id, second.id]);
  });

  it('moves the lead seat when another Creator is assigned', async () => {
    await reviewer.post(`/projects/${project.id}/assign`, { creatorId: second.id }, 204);
    const seats = await team();
    expect(seats.find((s) => s.creatorId === lead.id)).toMatchObject({ isActive: false, isLead: false });
    expect(seats.find((s) => s.creatorId === second.id)).toMatchObject({ isActive: true, isLead: true });
    await lead.get(`/projects/${project.id}`, 404);
  });
});
