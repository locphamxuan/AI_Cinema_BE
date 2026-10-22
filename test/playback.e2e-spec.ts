import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from 'src/common/http/api-exception.filter';
import { REMOVED_NOTICE } from 'src/modules/catalog/episode-visibility';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface SessionView {
  sessionId: string;
  episodeId: string;
  accessType: string;
  status: string;
  startPositionSeconds: number;
  stream: { masterUrl: string; qualities: string[]; durationSeconds: number | null };
  aiLabel: { type: string; text: string } | null;
  adSchedule: { breakId: string; positionSeconds: number }[];
  resumePositionSeconds?: number;
  reused?: boolean;
}

describe('Playback viewing experience (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let member: Actor;
  let admin: Actor;
  let project: ProjectDetail;

  const episodeId = (i: number) => episodesOf(project)[i].id;
  const guestKey = randomUUID();

  /** A Guest: no token, only X-Guest-Key. */
  const guest = async <T>(method: 'get' | 'post' | 'patch', path: string, body?: object, status = 200): Promise<T> => {
    const res = await request(app.getHttpServer())[method](`/api${path}`).set('X-Guest-Key', guestKey).send(body);
    if (res.status !== status)
      throw new Error(`${method.toUpperCase()} ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, member, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'member01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 3);
    for (let i = 0; i < 3; i += 1) {
      await compliantEpisode(reviewer, creator, episodeId(i));
      await reviewer.patch(`/episodes/${episodeId(i)}/coin-price`, { coinPrice: 10 });
      await reviewer.post(`/episodes/${episodeId(i)}/publications`, {});
    }
  }, 120000);

  afterAll(() => app.close());

  it('guest plays a free starter episode end to end: access, session, heartbeat, stop', async () => {
    const access = await guest<{ accessGranted: boolean; source: string }>('get', `/episodes/${episodeId(0)}/access`);
    expect(access).toMatchObject({ accessGranted: true, source: 'FREE_STARTER' });

    const session = await guest<SessionView>('post', '/playback/sessions', { episodeId: episodeId(0) }, 201);
    expect(session).toMatchObject({ episodeId: episodeId(0), status: 'ACTIVE', startPositionSeconds: 0 });
    expect(session.stream.masterUrl).toContain('/media/');
    expect(session.aiLabel).toMatchObject({ type: 'AI_GENERATED' });
    expect(session.adSchedule).toEqual([]);

    const beating = await guest<SessionView & { positionSeconds: number }>(
      'patch',
      `/playback/sessions/${session.sessionId}/heartbeat`,
      { positionSeconds: 30, watchedSeconds: 12 },
    );
    expect(beating).toMatchObject({ positionSeconds: 30 });

    const stopped = await guest<{ status: string; positionSeconds: number }>(
      'post',
      `/playback/sessions/${session.sessionId}/stop`,
      { positionSeconds: 40 },
    );
    expect(stopped).toMatchObject({ status: 'ENDED', positionSeconds: 40 });
  });

  it('guest without access is sent back to Main Flow 2', async () => {
    await guest('post', '/playback/sessions', { episodeId: episodeId(2) }, 403);
  });

  it('member resumes, completes and re-reads history; next points at the following episode', async () => {
    const first = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(1) }, 201);
    await member.patch(`/playback/sessions/${first.sessionId}/heartbeat`, { positionSeconds: 30, watchedSeconds: 10 });
    await member.post(`/playback/sessions/${first.sessionId}/stop`, { positionSeconds: 30 });

    const second = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(1) }, 201);
    expect(second).toMatchObject({ resumePositionSeconds: 30 });

    const progress = await member.get<{
      found: boolean;
      positionSeconds: number;
      completed: boolean;
    }>(`/playback/episodes/${episodeId(1)}/progress`);
    expect(progress).toMatchObject({ found: true, positionSeconds: 30, completed: false });

    // P3-3: finishing below the completion threshold closes the session but must not
    // mark the episode watched — one call alone cannot inflate history/completion stats.
    const unfinished = await member.post<{ completed: boolean }>(`/playback/sessions/${second.sessionId}/complete`, {
      positionSeconds: 30,
    });
    expect(unfinished).toMatchObject({ completed: false });
    const stillOpen = await member.get<{ completed: boolean }>(`/playback/episodes/${episodeId(1)}/progress`);
    expect(stillOpen).toMatchObject({ completed: false });

    // Reaching the threshold (mock duration 60s, 90% = 54s) does mark it completed.
    const third = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(1) }, 201);
    await member.post(`/playback/sessions/${third.sessionId}/complete`, { positionSeconds: 55 });

    const done = await member.get<{ completed: boolean }>(`/playback/episodes/${episodeId(1)}/progress`);
    expect(done).toMatchObject({ completed: true });

    const history = await member.get<{ data: { episodeId: string }[] }>('/playback/history');
    expect(history.data.map((row) => row.episodeId)).toContain(episodeId(1));

    const next = await member.get<{ episodeId: string | null }>(`/playback/episodes/${episodeId(0)}/next`);
    expect(next.episodeId).toBe(episodeId(1));
    const last = await member.get<{ episodeId: string | null }>(`/playback/episodes/${episodeId(2)}/next`);
    expect(last.episodeId).toBeNull();
  });

  it('admin manages the ad catalog; token playlists stay disabled without a secret', async () => {
    const created = await admin.post<{ id: string; status: string }>('/admin/ads', {
      title: `Trà sữa e2e ${Date.now()}`,
      mediaUrl: 'https://cdn.aicinema.example/public/ads/e2e-15s.mp4',
      durationSeconds: 15,
      weight: 2,
    });
    expect(created.status).toBe('ACTIVE');
    await admin.patch(`/admin/ads/${created.id}`, { status: 'PAUSED' }, 200);

    const session = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(0) }, 201);
    const token = new URL(session.stream.masterUrl);
    expect(token.pathname).toContain('/media/');
    await member.get(
      `/playback/s/${session.sessionId}/master.m3u8?s=${session.sessionId}&exp=2000000000&sig=${'0'.repeat(64)}`,
      422,
    );
    await member.post(
      `/playback/sessions/${session.sessionId}/ad-breaks/00000000-0000-4000-8000-000000000000/played`,
      {},
      404,
    );
  });

  it('answers a taken-down episode with its maintenance reason, before and during the handoff (BR-56)', async () => {
    const live = (
      await reviewer.get<{ id: string; publishedAt: string | null }[]>(`/episodes/${episodeId(2)}/publications`)
    ).find((publication) => publication.publishedAt)!;
    await reviewer.post(
      `/publications/${live.id}/unpublish`,
      { mode: 'REVISION', reason: 'COMPLIANCE_ISSUE', note: 'Cảnh cuối cần làm lại phụ đề.' },
      200,
    );

    // Main Flow 2: the episode is listed, but nothing plays and nothing is on sale.
    const decision = await guest<{ accessGranted: boolean; availability: string; notice: string; nextAction: string }>(
      'get',
      `/episodes/${episodeId(2)}/access`,
    );
    expect(decision).toMatchObject({
      accessGranted: false,
      availability: 'UNDER_REVISION',
      notice: 'Tập đang được bảo trì / sửa đổi nội dung',
      nextAction: 'NOT_PLAYABLE',
    });

    // Main Flow 3: a caller who skips the decision still gets the reason, not a 404.
    const refused = await member.post<ApiErrorBody>('/playback/sessions', { episodeId: episodeId(2) }, 409);
    expect(refused.error.details).toMatchObject({ reason: 'EPISODE_UNDER_REVISION' });
  });

  it('keeps a removed episode in history, flagged so the player is not opened (P3-4)', async () => {
    const live = (
      await reviewer.get<{ id: string; publishedAt: string | null }[]>(`/episodes/${episodeId(1)}/publications`)
    ).find((publication) => publication.publishedAt)!;
    await reviewer.post(
      `/publications/${live.id}/unpublish`,
      { mode: 'REMOVAL', reason: 'COMPLIANCE_ISSUE', note: 'Tập bị gỡ khỏi nền tảng.' },
      200,
    );

    const history = await member.get<{
      data: { episodeId: string; available: boolean; notice: string | null }[];
    }>('/playback/history');
    const removed = history.data.find((row) => row.episodeId === episodeId(1));
    expect(removed).toMatchObject({ available: false, notice: REMOVED_NOTICE });
  });
});
