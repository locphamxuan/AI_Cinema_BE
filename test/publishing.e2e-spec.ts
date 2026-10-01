import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PublicationService } from 'src/modules/publishing/publication.service';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Publication {
  id: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  unpublishedAt: string | null;
  unpublishReason: string | null;
}
interface PriceResult {
  coinPrice: number;
  inRange: boolean;
  alert: { id: string; status: string } | null;
}
interface Alert {
  id: string;
  status: string;
  coinPrice: number;
  episode: { id: string };
}
type Bell = { data: { type: string; payload: Record<string, string> }[] };

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('Pricing and publishing (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
  });

  afterAll(() => app.close());

  const episodeId = (i: number) => episodesOf(project)[i].id;
  const statusOf = async (i: number) => {
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    return episodesOf(detail).find((e) => e.id === episodeId(i))?.status;
  };
  const bellOf = async (actor: Actor, type: string) =>
    (await actor.get<Bell>('/notifications?limit=100')).data.filter((n) => n.type === type);

  it('prices an episode; a price outside the range is kept and flagged to the Admin (BR-47)', async () => {
    const path = `/episodes/${episodeId(0)}/coin-price`;
    await creator.patch(path, { coinPrice: 10 }, 403);
    await reviewer.patch(path, { coinPrice: -1 }, 400);

    expect(await reviewer.patch<PriceResult>(path, { coinPrice: 10 })).toMatchObject({ inRange: true, alert: null });
    const flagged = await reviewer.patch<PriceResult>(path, { coinPrice: 120 });
    expect(flagged).toMatchObject({ coinPrice: 120, inRange: false, alert: { status: 'OPEN' } });

    const raised = await bellOf(admin, 'PRICE_OUT_OF_RANGE');
    expect(raised.some((n) => n.payload.priceAlertId === flagged.alert!.id)).toBe(true);
    await reviewer.get('/admin/price-alerts', 403);
    const open = await admin.get<{ data: Alert[] }>('/admin/price-alerts?filter.status=$eq:OPEN&limit=100');
    expect(open.data.find((a) => a.id === flagged.alert!.id)).toMatchObject({ coinPrice: 120 });
  });

  it('lets the Admin ask for a change but never edit the price; a new price settles the alert', async () => {
    const [alert] = (
      await admin.get<{ data: Alert[] }>('/admin/price-alerts?filter.status=$eq:OPEN&limit=100')
    ).data.filter((a) => a.episode.id === episodeId(0));
    await admin.post(`/admin/price-alerts/${alert.id}/request-change`, { note: 'x' }, 400);
    const asked = await admin.post<Alert>(
      `/admin/price-alerts/${alert.id}/request-change`,
      { note: 'Giá 120 Coin cao hơn nhiều so với khoảng của nền tảng.' },
      200,
    );
    expect(asked.status).toBe('CHANGE_REQUESTED');
    await admin.post(`/admin/price-alerts/${alert.id}/request-change`, { note: 'Nhắc lại lần hai.' }, 409);
    expect((await bellOf(reviewer, 'PRICE_CHANGE_REQUEST')).some((n) => n.payload.priceAlertId === alert.id)).toBe(
      true,
    );

    await reviewer.patch(`/episodes/${episodeId(0)}/coin-price`, { coinPrice: 15 });
    const resolved = await admin.get<{ data: Alert[] }>('/admin/price-alerts?filter.status=$eq:RESOLVED&limit=100');
    expect(resolved.data.some((a) => a.id === alert.id)).toBe(true);
  });

  it('refuses to release an episode that misses anything of BR-19, and says what', async () => {
    type Refusal = { error: { message: string; details?: string[] } };
    const path = `/episodes/${episodeId(0)}/publications`;
    const early = await reviewer.post<Refusal>(path, {}, 409);
    expect(early.error.message).toContain('AWAITING_MEDIA');

    await compliantEpisode(reviewer, creator, episodeId(0));
    const blocked = await reviewer.post<Refusal>(path, {}, 409);
    expect(blocked.error.details).toEqual(['the movie synopsis', 'the movie age rating (BR-54)']);

    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Một thám tử AI điều tra chuỗi vụ mất tích ở Đà Lạt.',
      ageRating: 'T16',
    });
    await reviewer.post(`/episodes/${episodeId(0)}/publications`, { scheduledAt: '2020-01-01T00:00:00Z' }, 400);
  });

  it('schedules, reschedules and publishes when the time comes (step 14)', async () => {
    const path = `/episodes/${episodeId(0)}/publications`;
    await reviewer.post(path, { scheduledAt: inHours(1) });
    const [scheduled] = await reviewer.post<Publication[]>(path, { scheduledAt: inHours(2) });
    expect(await statusOf(0)).toBe('SCHEDULED');
    expect(await reviewer.get<Publication[]>(path)).toHaveLength(1);

    const sweep = app.get(PublicationService);
    expect(await sweep.publishDue()).toBe(0);
    expect(await sweep.publishDue(new Date(Date.now() + 3 * 3_600_000))).toBe(1);

    const [published] = await reviewer.get<Publication[]>(path);
    expect(published.id).toBe(scheduled.id);
    expect(published.publishedAt).not.toBeNull();
    expect(await statusOf(0)).toBe('PUBLISHED');
    expect((await bellOf(creator, 'EPISODE_PUBLISHED')).some((n) => n.payload.publicationId === scheduled.id)).toBe(
      true,
    );
  });

  it('is blocked by the database too: no code path can publish around the gate (BR-19)', async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.episode.update({ where: { id: episodeId(1) }, data: { status: 'PUBLISHED' } })).rejects.toThrow(
      /BR-19/,
    );
    expect(await statusOf(1)).toBe('AWAITING_MEDIA');
  });

  it('takes an episode down with a reason and releases it again', async () => {
    const [live] = await reviewer.get<Publication[]>(`/episodes/${episodeId(0)}/publications`);
    await reviewer.post(`/publications/${live.id}/unpublish`, { reason: 'MANUAL' }, 400);
    await creator.post(`/publications/${live.id}/unpublish`, { reason: 'MANUAL', note: 'Gỡ thử.' }, 403);

    const after = await reviewer.post<Publication[]>(
      `/publications/${live.id}/unpublish`,
      { reason: 'COMPLIANCE_ISSUE', note: 'Khán giả báo cảnh gây nhầm lẫn với người thật.' },
      200,
    );
    expect(after[0]).toMatchObject({ unpublishReason: 'COMPLIANCE_ISSUE' });
    expect(await statusOf(0)).toBe('UNPUBLISHED');
    await reviewer.post(`/publications/${live.id}/unpublish`, { reason: 'MANUAL', note: 'Lần hai.' }, 409);

    const releases = await reviewer.post<Publication[]>(`/episodes/${episodeId(0)}/publications`, {});
    expect(releases).toHaveLength(2);
    expect(releases[0].publishedAt).not.toBeNull();
    expect(await statusOf(0)).toBe('PUBLISHED');
  });

  it('cancels a scheduled release, and completes the project once every episode is out (BR-38)', async () => {
    await compliantEpisode(reviewer, creator, episodeId(1));
    await reviewer.patch(`/episodes/${episodeId(1)}/coin-price`, { coinPrice: 5 });
    const [pending] = await reviewer.post<Publication[]>(`/episodes/${episodeId(1)}/publications`, {
      scheduledAt: inHours(5),
    });
    await reviewer.post(
      `/publications/${pending.id}/unpublish`,
      { reason: 'MANUAL', note: 'Dời lịch sang tuần sau.' },
      200,
    );
    expect(await statusOf(1)).toBe('COMPLIANCE_PASSED');
    expect((await reviewer.get<{ status: string }>(`/projects/${project.id}`)).status).toBe('IN_PRODUCTION');

    await reviewer.post(`/episodes/${episodeId(1)}/publications`, {});
    expect((await reviewer.get<{ status: string }>(`/projects/${project.id}`)).status).toBe('COMPLETED');

    const events = await reviewer.get<{ action: string }[]>(`/projects/${project.id}/events`);
    const actions = new Set(events.map((e) => e.action));
    for (const action of [
      'EPISODE_PRICED',
      'PRICE_OUT_OF_RANGE',
      'EPISODE_SCHEDULED',
      'EPISODE_PUBLISHED',
      'EPISODE_UNPUBLISHED',
      'PROJECT_COMPLETED',
    ]) {
      expect(actions).toContain(action);
    }
  });
});
