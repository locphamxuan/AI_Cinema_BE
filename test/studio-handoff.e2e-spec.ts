import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OverdueEpisodesJob } from 'src/modules/production/studio-handoff/overdue-episodes.job';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { DISCLOSURE, MP4 } from './support/media';
import {
  assignedProject,
  episodesOf,
  HANDOFF_FEE_VND,
  inDays,
  newStudio,
  type ProjectDetail,
  studioAccount,
} from './support/projects';

interface Handoff {
  id: string;
  seasonId: string | null;
  milestoneStatus: string;
  changeReason: string | null;
  offeredFeeVnd: number;
  forfeitedVnd: number;
  studio: { id: string; name: string; email: string };
  filmSentNote: string | null;
  filmLinks: { episodeId: string; version: string; fileName: string; url: string }[];
  milestoneEvents: { fromStatus: string | null; toStatus: string; mediaAsset: { id: string } | null }[];
}

interface Contract extends Row {
  round: number;
  status: string;
  costVnd: number | null;
  handoff: { id: string } | null;
}

interface Script {
  status: string;
  currentVersion: number;
  versions: { version: number }[];
  reviews: { stage: string; approved: boolean }[];
}

/**
 * MF-1 (07/11/2026): Final Script → system template contract → the studio (logged in) quotes and signs → the Admin
 * countersigns or counter-proposes until both signed → the signed contract hands the project off → the studio
 * delivers its film to the Reviewer through its portal.
 */
describe('Studio contract and hand-off (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let studio: Actor;
  let project: ProjectDetail;
  let handoffId: string;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, creator, 2);
    studio = await studioAccount(admin, project.studio!.id);
  });

  afterAll(() => app.close());

  const handoffs = () => reviewer.get<Handoff[]>(`/projects/${project.id}/handoffs`);
  const contracts = () => admin.get<Contract[]>(`/projects/${project.id}/contracts`);
  const script = (path = '') => `/projects/${project.id}/script${path}`;

  it('takes the script through the Reviewer and the Admin, both able to send it back', async () => {
    await reviewer.post(script('/versions'), { content: 'x' }, 403);
    await creator.post(script('/versions'), { content: 'CẢNH 1 — bản nháp' });
    await creator.post(script('/versions'), { content: 'again' }, 409);
    await reviewer.post(script('/review'), { approve: false }, 400);
    await reviewer.post(script('/review'), { approve: false, comment: 'Mở đầu quá chậm.' });
    await admin.post(script('/final-review'), { approve: true }, 409);

    await creator.post(script('/versions'), { content: 'CẢNH 1 — bản 2', note: 'Cắt bớt mở đầu' });
    await reviewer.post(script('/review'), { approve: true });
    await admin.post(script('/final-review'), { approve: false, comment: 'Đổi kết phim.' });
    expect((await creator.get<Script>(script())).status).toBe('REVISION_REQUESTED');

    await creator.post(script('/versions'), { content: 'CẢNH 1 — bản 3' });
    await reviewer.post(script('/review'), { approve: true });
    // Every episode needs a deadline before the studio is contracted.
    const [, second] = episodesOf(project);
    const prisma = app.get(PrismaService);
    await prisma.episode.update({ where: { id: second.id }, data: { deliveryDeadline: null } });
    await admin.post(script('/final-review'), { approve: true }, 409);
    await reviewer.patch(`/episodes/${second.id}`, { deliveryDeadline: inDays(14) });
    await reviewer.post(script('/final-review'), { approve: true }, 403);
    const final = await admin.post<Script>(script('/final-review'), { approve: true });
    expect(final).toMatchObject({ status: 'FINAL', currentVersion: 3 });
    expect(final.reviews.map((r) => [r.stage, r.approved])[0]).toEqual(['ADMIN', true]);
    await creator.post(script('/versions'), { content: 'too late' }, 409);

    const [template] = await contracts();
    expect(template).toMatchObject({ round: 1, status: 'SENT', costVnd: null, handoff: null });
    expect((await reviewer.get<ProjectDetail>(`/projects/${project.id}`)).status).toBe('ASSIGNED');
  });

  it('shows the studio only its own projects, with the Final Script', async () => {
    const stranger = await studioAccount(admin, (await newStudio(admin, 'Studio lạ')).id);
    expect(await stranger.get<Row[]>('/studio-portal/contracts')).toEqual([]);
    await stranger.get(`/studio-portal/projects/${project.id}`, 404);
    await creator.get('/studio-portal/contracts', 403);

    const detail = await studio.get<{ finalScript: { version: number; content: string } }>(
      `/studio-portal/projects/${project.id}`,
    );
    expect(detail.finalScript).toMatchObject({ version: 3, content: 'CẢNH 1 — bản 3' });
    // No film before both signatures.
    await studio.upload(
      `/studio-portal/episodes/${episodesOf(project)[0].id}/media/upload`,
      { field: 'file', name: 'tap.mp4', content: MP4 },
      { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' },
      409,
    );
  });

  it('negotiates the cost round by round until both sides signed, then hands the project off', async () => {
    const [template] = await contracts();
    await admin.post(`/contracts/${template.id}/sign`, {}, 409);
    await studio.post(`/studio-portal/contracts/${template.id}/propose`, { costVnd: 45_000_500 }, 400);
    await studio.post(`/studio-portal/contracts/${template.id}/propose`, { costVnd: 45_000_000 }, 200);
    // The Admin's counter must fit the budget (100 000 000).
    await admin.post(`/contracts/${template.id}/counter`, { costVnd: 100_001_000 }, 409);
    const countered = await admin.post<Contract>(`/contracts/${template.id}/counter`, { costVnd: 35_000_000 }, 200);
    expect(countered).toMatchObject({ round: 2, status: 'ADMIN_COUNTERED' });
    const again = await studio.post<Contract>(
      `/studio-portal/contracts/${countered.id}/counter`,
      { costVnd: HANDOFF_FEE_VND },
      200,
    );
    expect(again).toMatchObject({ round: 3, status: 'STUDIO_SIGNED' });
    const signed = await admin.post<Contract>(`/contracts/${again.id}/sign`, {}, 200);
    expect(signed.status).toBe('SIGNED');
    expect(signed.handoff).not.toBeNull();
    handoffId = signed.handoff!.id;

    const rounds = await contracts();
    expect(rounds.map((c) => c.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'SIGNED']);
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail.status).toBe('IN_PRODUCTION');
    const [handoff] = await handoffs();
    expect(handoff).toMatchObject({ milestoneStatus: 'IN_PROGRESS', offeredFeeVnd: HANDOFF_FEE_VND });
    const episodes = await app.get(PrismaService).episode.findMany({ where: { movieId: project.id } });
    for (const episode of episodes) {
      expect(episode.status).toBe('AWAITING_MEDIA');
      expect(episode.dueDate).toEqual(episode.deliveryDeadline);
    }
    await admin.post(`/projects/${project.id}/contracts`, {}, 409);
  });

  it('takes the studio film to the Reviewer, who asks the studio for changes directly', async () => {
    const [first] = episodesOf(project);
    const submission = await studio.upload<Row>(
      `/studio-portal/episodes/${first.id}/media/upload`,
      { field: 'file', name: 'tap.mp4', content: MP4 },
      { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' },
    );
    const [handoff] = await handoffs();
    expect(handoff.milestoneStatus).toBe('DELIVERED');
    expect(handoff.milestoneEvents.at(-1)?.mediaAsset?.id).toBe(submission.id);

    await reviewer.post(
      `/media-assets/${submission.id}/reviews`,
      { decision: 'CHANGES_REQUESTED', comments: 'Màu cảnh 2 quá tối.' },
      200,
    );
    const bell = await studio.get<{ data: { type: string }[] }>('/notifications');
    expect(bell.data.map((n) => n.type)).toContain('CONTENT_CHANGES_REQUESTED');
    const detail = await studio.get<{ episodes: { latestDelivery: { changeRequest: { comments: string } } }[] }>(
      `/studio-portal/projects/${project.id}`,
    );
    expect(detail.episodes[0].latestDelivery.changeRequest.comments).toBe('Màu cảnh 2 quá tối.');
  });

  it('emails the studio under the name of the Admin or the Reviewer, with no attachment', async () => {
    const prisma = app.get(PrismaService);
    const { email } = await prisma.studio.findUniqueOrThrow({ where: { id: project.studio!.id } });
    const mails = await prisma.emailMessage.findMany({ where: { toEmail: email }, orderBy: { createdAt: 'asc' } });
    const sent = mails.map((mail) => ({
      replyTo: (mail.payload as { replyTo: string }).replyTo,
      template: mail.template,
      status: mail.status,
      attachments: mail.attachmentKeys.length,
    }));
    const from = (replyTo: string) => ({ replyTo, template: 'STUDIO_UPDATE', status: 'SENT', attachments: 0 });
    // Template, the Admin's counter, the signature, then the Reviewer's change request.
    expect(sent).toEqual([
      from('admin@aicinema.com'),
      from('admin@aicinema.com'),
      from('admin@aicinema.com'),
      from('reviewer01@aicinema.com'),
    ]);
  });

  it('keeps the link of every episode the studio mails back, the newest one each (BR-58)', async () => {
    const [first, second] = episodesOf(project);
    const [handoff] = await handoffs();
    const film = (episode: number, version: string) => ({
      episode,
      fileName: `tap-${episode}.mp4`,
      url: `http://127.0.0.1:3100/films/${version}/tap-${episode}.mp4`,
    });
    const report = {
      studioEmail: handoff.studio.email,
      creatorEmail: 'creator01@aicinema.com',
      movieTitle: project.title,
      scope: 'Toàn bộ dự án',
      version: 'v1',
      label: 'Bản giao đầu',
      episodes: [film(1, 'v1')],
    };
    const inbound = (token: string, body: object) =>
      request(app.getHttpServer()).post('/api/studio-inbound/film-sent').set('x-studio-token', token).send(body);

    await inbound('wrong-token', report).expect(401);
    await inbound('e2e-studio-token', { ...report, episodes: [] }).expect(400);
    await inbound('e2e-studio-token', report).expect(200);
    await inbound('e2e-studio-token', {
      ...report,
      version: 'v2',
      episodes: [film(1, 'v2'), film(2, 'v2'), film(9, 'v2')],
    }).expect(200);

    const [after] = await handoffs();
    expect(after.filmSentNote).toContain('v2');
    expect(after.filmLinks.map((link) => [link.episodeId, link.version, link.url])).toEqual([
      [first.id, 'v2', film(1, 'v2').url],
      [second.id, 'v2', film(2, 'v2').url],
    ]);
  });

  it('changes the studio only with a reason, from the catalog, and keeps the history', async () => {
    const next = await newStudio(reviewer, 'Studio B');
    const inactive = await newStudio(reviewer, 'Studio C');
    await reviewer.patch(`/studios/${inactive.id}`, { isActive: false });
    const path = `/projects/${project.id}/studio-change`;

    const reason = 'Studio đầu tiên trễ hạn hai lần.';
    const swap = { studioId: next.id, reason, offeredFeeVnd: 70_000_000 };
    // The Admin deals with the studios now, not the Creator.
    await creator.post(path, swap, 403);
    await admin.post(path, { studioId: next.id, offeredFeeVnd: 70_000_000 }, 400);
    await admin.post(path, { ...swap, studioId: inactive.id }, 409);
    // BR-59: the old studio keeps what it was paid; the rest of its 40M returns to the 60M left.
    await admin.post(path, { ...swap, forfeitedVnd: 50_000_000 }, 400);
    await admin.post(path, { ...swap, forfeitedVnd: 31_000_000 }, 409);
    const history = await admin.post<Handoff[]>(path, { ...swap, forfeitedVnd: 30_000_000 });

    expect(history.map((h) => h.studio.name)).toEqual(['Studio B', 'Studio Ánh Trăng']);
    expect(history.map((h) => h.milestoneStatus)).toEqual(['BRIEF_SENT', 'SUPERSEDED']);
    expect(history.map((h) => [h.offeredFeeVnd, h.forfeitedVnd])).toEqual([
      [70_000_000, 0],
      [HANDOFF_FEE_VND, 30_000_000],
    ]);
    const cost = await reviewer.get<Row>(`/projects/${project.id}/costs`);
    expect(cost).toMatchObject({ budgetVnd: 100_000_000, committedVnd: 100_000_000, remainingVnd: 0 });
    expect(history[0].changeReason).toContain('trễ hạn');
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail.studio?.id).toBe(next.id);
    // A superseded hand-off is final.
    await creator.patch(`/projects/${project.id}/handoffs/${handoffId}/milestone`, { status: 'IN_PROGRESS' }, 409);
  });

  it('flags an overdue episode once to its Creator and Reviewer (BR-38)', async () => {
    // The first episode was delivered; the second still waits for the studio.
    const [, second] = episodesOf(project);
    await app
      .get(PrismaService)
      .episode.update({ where: { id: second.id }, data: { dueDate: new Date('2026-01-01') } });
    const job = app.get(OverdueEpisodesJob);

    expect(await job.sweep()).toBeGreaterThanOrEqual(1);
    await job.sweep();
    const bell = await creator.get<{ data: { type: string; payload: { episodeId: string } }[] }>(
      '/notifications?limit=100',
    );
    const overdue = bell.data.filter((n) => n.type === 'EPISODE_OVERDUE' && n.payload.episodeId === second.id);
    expect(overdue).toHaveLength(1);
  });
});
