import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OverdueEpisodesJob } from 'src/modules/production/studio-handoff/overdue-episodes.job';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { deliver } from './support/media';
import { assignedProject, episodesOf, inDays, newStudio, type ProjectDetail } from './support/projects';

interface Handoff {
  id: string;
  seasonId: string | null;
  milestoneStatus: string;
  changeReason: string | null;
  productionFeeTokens: number;
  studio: { id: string; name: string };
  emailMessage: { status: string };
  materials: { id: string; kind: string; fileName: string }[];
  milestoneEvents: { fromStatus: string | null; toStatus: string; mediaAsset: { id: string } | null }[];
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const SCRIPT = { field: 'scripts', name: 'kich-ban.pdf', content: PDF };
const REFERENCE = { field: 'references', name: 'tham-khao.txt', content: Buffer.from('Phong cách u tối, màu lạnh.') };

describe('Studio hand-off (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let otherCreator: Actor;
  let project: ProjectDetail;
  let handoffId: string;

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

  const handoffs = () => reviewer.get<Handoff[]>(`/projects/${project.id}/handoffs`);

  it('is reserved to the assigned Creator and dues each episode on its Reviewer deadline', async () => {
    const [first, second] = episodesOf(project);
    await otherCreator.post(`/projects/${project.id}/handoff`, {}, 404);
    await reviewer.post(`/projects/${project.id}/handoff`, {}, 403);
    // A deadline already past has to be moved by the Reviewer before the hand-off.
    const prisma = app.get(PrismaService);
    await prisma.episode.update({
      where: { id: second.id },
      data: { deliveryDeadline: new Date('2026-01-01'), expectedReleaseDate: null },
    });
    await creator.post(`/projects/${project.id}/handoff`, {}, 409);
    await reviewer.patch(`/episodes/${second.id}`, { deliveryDeadline: inDays(14) });

    const history = await creator.upload<Handoff[]>(`/projects/${project.id}/handoff`, [SCRIPT, REFERENCE]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ seasonId: null, milestoneStatus: 'BRIEF_SENT', productionFeeTokens: 20000 });
    handoffId = history[0].id;
    // Without SMTP the mailer only logs, so the brief counts as sent.
    expect(history[0].emailMessage.status).toBe('SENT');
    expect(history[0].materials.map((m) => [m.kind, m.fileName])).toEqual([
      ['SCRIPT', 'kich-ban.pdf'],
      ['REFERENCE', 'tham-khao.txt'],
    ]);
    expect(history[0].milestoneEvents.map((e) => [e.fromStatus, e.toStatus])).toEqual([[null, 'BRIEF_SENT']]);

    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail.status).toBe('IN_PRODUCTION');
    const episodes = await prisma.episode.findMany({ where: { id: { in: [first.id, second.id] } } });
    for (const episode of episodes) {
      expect(episode.status).toBe('AWAITING_MEDIA');
      expect(episode.dueDate).toEqual(episode.deliveryDeadline);
    }
    await creator.post(`/projects/${project.id}/handoff`, {}, 409);
  });

  it('refuses a material whose content is not what its extension says', async () => {
    const fake = { field: 'scripts', name: 'x.pdf', content: Buffer.from('not a pdf') };
    const other = await assignedProject(reviewer, creator, 1);
    await creator.upload(`/projects/${other.id}/handoff`, fake, {}, 400);
  });

  it('moves the studio due date with the Reviewer deadline', async () => {
    const [, second] = episodesOf(project);
    await creator.patch(`/episodes/${second.id}`, { deliveryDeadline: inDays(20) }, 403);
    await reviewer.patch(`/episodes/${second.id}`, { deliveryDeadline: inDays(20) });
    const episode = await app.get(PrismaService).episode.findUniqueOrThrow({ where: { id: second.id } });
    expect(episode.dueDate?.toISOString().slice(0, 10)).toBe(inDays(20));
  });

  it('serves the brief PDF and the material to the people of the project', async () => {
    const [handoff] = await handoffs();
    const pdf = await reviewer.download(`/projects/${project.id}/handoffs/${handoff.id}/brief`);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const material = await creator.download(
      `/projects/${project.id}/handoffs/${handoff.id}/materials/${handoff.materials[0].id}/content`,
    );
    expect(material.body.equals(PDF)).toBe(true);
    await otherCreator.get(`/projects/${project.id}/handoffs`, 404);
  });

  it('lets only the Creator move the milestone, step by step, and DELIVERED needs the Submission (BR-58)', async () => {
    const path = `/projects/${project.id}/handoffs/${handoffId}/milestone`;
    await reviewer.patch(path, { status: 'STUDIO_ACCEPTED' }, 403);
    await otherCreator.patch(path, { status: 'STUDIO_ACCEPTED' }, 404);
    await creator.patch(path, { status: 'DELIVERED', mediaAssetId: '00000000-0000-4000-8000-000000000000' }, 409);
    await creator.patch(path, { status: 'SUPERSEDED' }, 400);

    await creator.patch(path, { status: 'STUDIO_ACCEPTED', note: 'Studio xác nhận qua email.' });
    await creator.patch(path, { status: 'IN_PROGRESS' });
    await creator.patch(path, { status: 'DELIVERED' }, 400);
    await creator.patch(path, { status: 'DELIVERED', mediaAssetId: '00000000-0000-4000-8000-000000000000' }, 400);

    const submission = await deliver(creator, episodesOf(project)[0].id);
    const delivered = await creator.patch<Handoff>(path, { status: 'DELIVERED', mediaAssetId: submission.id });
    expect(delivered.milestoneStatus).toBe('DELIVERED');

    const [handoff] = await handoffs();
    expect(handoff.milestoneEvents.map((e) => e.toStatus)).toEqual([
      'BRIEF_SENT',
      'STUDIO_ACCEPTED',
      'IN_PROGRESS',
      'DELIVERED',
    ]);
    expect(handoff.milestoneEvents[3].mediaAsset?.id).toBe(submission.id);
    const asset = await creator.get<{ studioHandoff: { id: string } }>(`/media-assets/${submission.id}`);
    expect(asset.studioHandoff.id).toBe(handoffId);
    // The Reviewer asked for changes: the work reopens.
    await creator.patch(path, { status: 'IN_PROGRESS', note: 'Reviewer yêu cầu sửa màu.' });
  });

  it('changes the studio only with a reason, from the catalog, and keeps the history', async () => {
    const next = await newStudio(reviewer, 'Studio B');
    const inactive = await newStudio(reviewer, 'Studio C');
    await reviewer.patch(`/studios/${inactive.id}`, { isActive: false });
    const path = `/projects/${project.id}/studio-change`;

    await creator.post(path, { studioId: next.id }, 400);
    await creator.post(path, { studioId: inactive.id, reason: 'Studio đầu tiên trễ hạn hai lần.' }, 409);
    const history = await creator.post<Handoff[]>(path, {
      studioId: next.id,
      reason: 'Studio đầu tiên trễ hạn hai lần.',
    });

    expect(history.map((h) => h.studio.name)).toEqual(['Studio B', 'Studio Ánh Trăng']);
    expect(history.map((h) => h.milestoneStatus)).toEqual(['BRIEF_SENT', 'SUPERSEDED']);
    expect(history[0].changeReason).toContain('trễ hạn');
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail.studio?.id).toBe(next.id);
    // A superseded hand-off is final.
    await creator.patch(`/projects/${project.id}/handoffs/${handoffId}/milestone`, { status: 'IN_PROGRESS' }, 409);
  });

  it('hands off one season at a time and replaces only that season', async () => {
    const seasonProject = await assignedProject(reviewer, creator, 1);
    const extra = await reviewer.post<Row & { episodes: Row[] }>(`/projects/${seasonProject.id}/seasons`, {
      releaseStartDate: inDays(60),
      releaseEndDate: inDays(120),
      episodes: [{ title: 'Tập mùa 2', targetDurationSeconds: 600, deliveryDeadline: inDays(45) }],
    });
    const [season1] = seasonProject.seasons;
    await creator.post(
      `/projects/${seasonProject.id}/handoff`,
      { seasonId: '00000000-0000-4000-8000-000000000000' },
      404,
    );

    const first = await creator.post<Handoff[]>(`/projects/${seasonProject.id}/handoff`, { seasonId: season1.id });
    expect(first[0].seasonId).toBe(season1.id);
    const second = await creator.post<Handoff[]>(`/projects/${seasonProject.id}/handoff`, { seasonId: extra.id });
    expect(second.map((h) => h.seasonId)).toEqual([extra.id, season1.id]);
    await creator.post(`/projects/${seasonProject.id}/handoff`, { seasonId: extra.id }, 409);

    const studio = await newStudio(reviewer, 'Studio D');
    const changed = await creator.post<Handoff[]>(`/projects/${seasonProject.id}/studio-change`, {
      studioId: studio.id,
      seasonId: extra.id,
      reason: 'Mùa 2 cần studio hoạt hình.',
    });
    expect(changed.map((h) => h.milestoneStatus)).toEqual(['BRIEF_SENT', 'SUPERSEDED', 'BRIEF_SENT']);
    expect(changed.map((h) => h.seasonId)).toEqual([extra.id, extra.id, season1.id]);
  });

  it('flags an overdue episode once to its Creator and Reviewer (BR-38)', async () => {
    // The first episode was delivered; the second still waits for the studio.
    const [, first] = episodesOf(project);
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
