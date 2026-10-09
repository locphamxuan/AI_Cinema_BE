import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { DISCLOSURE, MP4 } from './support/media';
import { assignedProject, episodesOf, type ProjectDetail } from './support/projects';

interface Overview {
  studio: { studioName: string; response: string | null; declineReason: string | null };
  project: { title: string; status: string };
  canDeliver: boolean;
  seasons: { episodes: { id: string; status: string; latestDelivery: { version: number } | null }[] }[];
  ideaFiles: { id: string }[];
}

interface Handoff extends Row {
  studioName: string;
  studioResponse: string | null;
  portalActive: boolean;
}

describe('Studio portal (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let project: ProjectDetail;
  let token: string;

  const portal = () => request(app.getHttpServer());
  const studio = { studioName: 'Studio Ánh Trăng', studioEmail: 'portal@anhtrang.example' };

  /** The link of the last email sent to `email`: the e2e mailer only logs, so read the outbox. */
  const lastLinkTo = async (email: string) => {
    const message = await app.get(PrismaService).emailMessage.findFirstOrThrow({
      where: { toEmail: email },
      orderBy: { createdAt: 'desc' },
    });
    const text = (message.payload as { text: string }).text;
    return /\/studio\/([A-Za-z0-9_-]{43})/.exec(text)![1];
  };

  const handOff = async (target: ProjectDetail, email = studio.studioEmail) => {
    await creator.post(`/projects/${target.id}/handoff`, { ...studio, studioEmail: email });
    return lastLinkTo(email);
  };

  const upload = (link: string, episodeId: string, status: number) =>
    portal()
      .post(`/api/studio-portal/${link}/episodes/${episodeId}/media/upload`)
      .attach('file', MP4, 'tap.mp4')
      .field('aiDisclosure', JSON.stringify(DISCLOSURE))
      .field('proposedLabelType', 'AI_GENERATED')
      .expect(status);

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, creator, 2);
    token = await handOff(project);
  });

  afterAll(() => app.close());

  it('opens the hand-off to anyone holding the emailed link, and to nobody else', async () => {
    const { body } = await portal().get(`/api/studio-portal/${token}`).expect(200);
    const overview = body as Overview;
    expect(overview.studio).toMatchObject({ studioName: 'Studio Ánh Trăng', response: null });
    expect(overview.canDeliver).toBe(false);
    expect(overview.seasons[0].episodes).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/portalTokenHash|storageKey|coinPrice|milestoneDate/);

    await portal()
      .get(`/api/studio-portal/${'x'.repeat(43)}`)
      .expect(404);
    await portal().get('/api/studio-portal/not-a-token').expect(404);
    const brief = await portal().get(`/api/studio-portal/${token}/brief`).expect(200);
    expect(brief.headers['content-type']).toContain('application/pdf');
  });

  it('lets the studio deliver only after accepting the brief and its terms', async () => {
    const [first] = episodesOf(project);
    await upload(token, first.id, 409);

    await portal().post(`/api/studio-portal/${token}/response`).send({ decision: 'ACCEPT' }).expect(400);
    await portal().post(`/api/studio-portal/${token}/response`).send({ decision: 'DECLINE' }).expect(400);
    const { body } = await portal()
      .post(`/api/studio-portal/${token}/response`)
      .send({ decision: 'ACCEPT', acceptTerms: true })
      .expect(201);
    expect(body).toMatchObject({ studio: { response: 'ACCEPTED' }, canDeliver: true });
    await portal()
      .post(`/api/studio-portal/${token}/response`)
      .send({ decision: 'DECLINE', reason: 'Đổi ý rồi.' })
      .expect(409);

    const bell = await creator.get<{ data: { type: string }[] }>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('STUDIO_ACCEPTED');
  });

  it('records a delivery as the studio’s own, with its AI Disclosure', async () => {
    const [first] = episodesOf(project);
    const { body } = (await upload(token, first.id, 201)) as { body: { id: string } };
    expect(body).toMatchObject({ version: 1, episodeId: first.id });
    expect(body).not.toHaveProperty('storageKey');

    const [version] = await creator.get<(Row & { submittedBy: unknown; studioHandoff: { studioName: string } })[]>(
      `/episodes/${first.id}/media`,
    );
    expect(version.submittedBy).toBeNull();
    expect(version.studioHandoff.studioName).toBe('Studio Ánh Trăng');

    const events = await app.get(PrismaService).auditLog.findMany({
      where: { entityId: body.id, action: 'MEDIA_SUBMITTED' },
    });
    expect(events).toEqual([expect.objectContaining({ actorType: 'STUDIO', actorId: null })]);

    // An episode of another project is out of reach of this link.
    const other = await assignedProject(reviewer, creator, 1);
    await upload(token, episodesOf(other)[0].id, 404);
  });

  it('shows the studio what the Reviewer asked to change', async () => {
    const [first] = episodesOf(project);
    const [version] = await reviewer.get<Row[]>(`/episodes/${first.id}/media`);
    await reviewer.post(
      `/media-assets/${version.id}/reviews`,
      { decision: 'CHANGES_REQUESTED', comments: 'Phút 03:10 nhạc nền quá to.' },
      200,
    );
    const { body } = await portal().get(`/api/studio-portal/${token}`).expect(200);
    const episode = (body as Overview).seasons[0].episodes[0] as unknown as {
      status: string;
      changesRequested: { comments: string };
    };
    expect(episode).toMatchObject({
      status: 'CHANGES_REQUESTED',
      changesRequested: { comments: 'Phút 03:10 nhạc nền quá to.' },
    });
  });

  it('kills the old link when the Creator sends a new one or changes the studio', async () => {
    await creator.post(`/projects/${project.id}/handoffs/portal-link`);
    const renewed = await lastLinkTo(studio.studioEmail);
    await portal().get(`/api/studio-portal/${token}`).expect(404);
    await portal().get(`/api/studio-portal/${renewed}`).expect(200);

    await creator.post(`/projects/${project.id}/studio-change`, {
      studioName: 'Studio B',
      studioEmail: 'portal-b@studio.example',
      reason: 'Studio đầu tiên trễ hạn.',
    });
    await portal().get(`/api/studio-portal/${renewed}`).expect(404);
    const second = await lastLinkTo('portal-b@studio.example');
    const { body } = await portal().get(`/api/studio-portal/${second}`).expect(200);
    expect((body as Overview).studio).toMatchObject({ studioName: 'Studio B', response: null });

    const history = await creator.get<Handoff[]>(`/projects/${project.id}/handoffs`);
    expect(history.map((h) => [h.studioName, h.portalActive])).toEqual([
      ['Studio B', true],
      ['Studio Ánh Trăng', false],
    ]);
    expect(history[0]).not.toHaveProperty('portalTokenHash');
  });

  it('tells the Creator when a studio declines, and then wants another studio', async () => {
    const declined = await assignedProject(reviewer, creator, 1);
    const link = await handOff(declined, 'busy@studio.example');
    await portal()
      .post(`/api/studio-portal/${link}/response`)
      .send({ decision: 'DECLINE', reason: 'Lịch studio đã kín tới tháng 12.' })
      .expect(201);

    const bell = await creator.get<{ data: { type: string; body: string }[] }>('/notifications?limit=100');
    expect(bell.data.find((n) => n.type === 'STUDIO_DECLINED')?.body).toContain('tháng 12');
    await creator.post(`/projects/${declined.id}/handoffs/portal-link`, {}, 409);
    await upload(link, episodesOf(declined)[0].id, 409);
  });

  it('closes the link once the project is cancelled', async () => {
    const cancelled = await assignedProject(reviewer, creator, 1);
    const link = await handOff(cancelled, 'gone@studio.example');
    await reviewer.post(`/projects/${cancelled.id}/cancel`, { reason: 'Hết ngân sách cho dự án.' }, 204);
    await portal().get(`/api/studio-portal/${link}`).expect(410);
  });
});
