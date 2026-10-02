import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OverdueEpisodesJob } from 'src/modules/production/studio-handoff/overdue-episodes.job';
import { type Actor, bootApp, signIn } from './support/api';
import { assignedProject, episodesOf, inDays, type ProjectDetail } from './support/projects';

interface Handoff {
  id: string;
  studioName: string;
  changeReason: string | null;
  productionFeeTokens: number;
  emailMessage: { status: string };
}

describe('Studio hand-off (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let otherCreator: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, otherCreator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'creator02@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, creator, 2);
  });

  afterAll(() => app.close());

  const studio = { studioName: 'Studio Ánh Trăng', studioEmail: 'Contact@AnhTrang.example' };

  it('is reserved to the assigned Creator and needs a future deadline for every episode', async () => {
    const [first, second] = episodesOf(project);
    const dueDates = [
      { episodeId: first.id, dueDate: inDays(7) },
      { episodeId: second.id, dueDate: inDays(14) },
    ];
    await otherCreator.post(`/projects/${project.id}/handoff`, { ...studio, dueDates }, 404);
    await reviewer.post(`/projects/${project.id}/handoff`, { ...studio, dueDates }, 403);
    await creator.post(`/projects/${project.id}/handoff`, { ...studio, dueDates: dueDates.slice(0, 1) }, 400);
    await creator.post(
      `/projects/${project.id}/handoff`,
      { ...studio, dueDates: [dueDates[0], { episodeId: second.id, dueDate: '2020-01-01' }] },
      400,
    );
    // The Reviewer's milestone is 30 days out; the studio cannot be due later.
    await creator.post(
      `/projects/${project.id}/handoff`,
      { ...studio, dueDates: [dueDates[0], { episodeId: second.id, dueDate: inDays(31) }] },
      400,
    );

    const history = await creator.post<Handoff[]>(`/projects/${project.id}/handoff`, { ...studio, dueDates });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ studioName: 'Studio Ánh Trăng', productionFeeTokens: 20000 });
    // Without SMTP the mailer only logs, so the brief counts as sent.
    expect(history[0].emailMessage.status).toBe('SENT');

    const detail = await reviewer.get<ProjectDetail & { studioEmail: string }>(`/projects/${project.id}`);
    expect(detail).toMatchObject({ status: 'IN_PRODUCTION', studioEmail: 'contact@anhtrang.example' });
    expect(episodesOf(detail).map((e) => e.status)).toEqual(['AWAITING_MEDIA', 'AWAITING_MEDIA']);
  });

  it('keeps every studio due date within the Reviewer milestone', async () => {
    const [, second] = episodesOf(project);
    await creator.put(
      `/projects/${project.id}/due-dates`,
      { dueDates: [{ episodeId: second.id, dueDate: inDays(31) }] },
      400,
    );
    await creator.put(`/projects/${project.id}/due-dates`, {
      dueDates: [{ episodeId: second.id, dueDate: inDays(30) }],
    });
    // Studio due in 30 days: the Reviewer cannot pull the milestone in before that…
    await reviewer.patch(`/episodes/${second.id}`, { milestoneDate: inDays(20) }, 409);
    // …until the Creator moves the deadline first.
    await creator.put(`/projects/${project.id}/due-dates`, {
      dueDates: [{ episodeId: second.id, dueDate: inDays(14) }],
    });
    await reviewer.patch(`/episodes/${second.id}`, { milestoneDate: inDays(20) });
  });

  it('serves the brief PDF to the people of the project', async () => {
    const [handoff] = await reviewer.get<Handoff[]>(`/projects/${project.id}/handoffs`);
    const pdf = await reviewer.download(`/projects/${project.id}/handoffs/${handoff.id}/brief`);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('changes the studio only with a reason and keeps the history', async () => {
    await creator.post(
      `/projects/${project.id}/studio-change`,
      { studioName: 'Studio B', studioEmail: 'b@studio.example' },
      400,
    );
    const history = await creator.post<Handoff[]>(`/projects/${project.id}/studio-change`, {
      studioName: 'Studio B',
      studioEmail: 'b@studio.example',
      reason: 'Studio đầu tiên trễ hạn hai lần.',
    });
    expect(history.map((h) => h.studioName)).toEqual(['Studio B', 'Studio Ánh Trăng']);
    expect(history[0].changeReason).toContain('trễ hạn');
  });

  it('flags an overdue episode once to its Creator and Reviewer (BR-38)', async () => {
    const [first] = episodesOf(project);
    await app.get(PrismaService).episode.update({ where: { id: first.id }, data: { dueDate: new Date('2026-01-01') } });
    const job = app.get(OverdueEpisodesJob);

    expect(await job.sweep()).toBeGreaterThanOrEqual(1);
    await job.sweep();
    const bell = await creator.get<{ data: { type: string; payload: { episodeId: string } }[] }>(
      '/notifications?limit=100',
    );
    const overdue = bell.data.filter((n) => n.type === 'EPISODE_OVERDUE' && n.payload.episodeId === first.id);
    expect(overdue).toHaveLength(1);
  });
});
