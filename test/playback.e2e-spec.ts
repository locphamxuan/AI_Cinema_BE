import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from 'src/common/http/api-exception.filter';
import { REMOVED_NOTICE } from 'src/modules/catalog/episode-visibility';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, MP4 } from './support/media';
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
    // The e2e database outlives a run and each run plays from a new device: free the member's
    // device slots the way a member would (MF-4), so the plan's device limit is not hit.
    const { devices } = await member.get<{ devices: { id: string }[] }>('/devices');
    for (const device of devices) await member.call('delete', `/devices/${device.id}`, undefined, 204);
    project = await projectInProduction(reviewer, creator, 3);
    // The release gate asks for both before an episode goes out (BR-19).
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Một nhóm bạn đi tìm tín hiệu lạ phát ra từ trạm vũ trụ bỏ hoang.',
      ageRating: 'T16',
    });
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
      201,
    );
    expect(stopped).toMatchObject({ status: 'ENDED', positionSeconds: 40 });
  });

  it('guest without access is sent back to Main Flow 2', async () => {
    await guest('post', '/playback/sessions', { episodeId: episodeId(2) }, 403);
  });

  it('member switches episodes mid-way on one device, sees it registered and frees a stream elsewhere (MF-4)', async () => {
    const first = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(0) }, 201);
    await member.patch(`/playback/sessions/${first.sessionId}/heartbeat`, { positionSeconds: 20, watchedSeconds: 10 });
    // Leaving episode 1 half-way for episode 2 on the same device is not a second stream.
    const second = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(1) }, 201);
    const stale = await member.patch<ApiErrorBody>(
      `/playback/sessions/${first.sessionId}/heartbeat`,
      { positionSeconds: 25, watchedSeconds: 5 },
      403,
    );
    expect(stale.error.details).toMatchObject({ reason: 'SESSION_NOT_ACTIVE' });

    const devices = await member.get<{
      limits: { maxRegisteredDevices: number; maxConcurrentStreams: number };
      devices: { id: string; current: boolean }[];
      activeSessions: { id: string; deviceId: string }[];
    }>('/devices');
    expect(devices.devices).toEqual([expect.objectContaining({ current: true })]);
    expect(devices.activeSessions).toEqual([
      expect.objectContaining({ id: second.sessionId, deviceId: devices.devices[0].id }),
    ]);

    await member.post(`/devices/sessions/${second.sessionId}/end`, {}, 204);
    expect((await member.get<{ activeSessions: unknown[] }>('/devices')).activeSessions).toEqual([]);
  });

  it('member saves a movie to watch later and takes it off again', async () => {
    await member.put(`/saved-movies/${project.id}`, {});
    expect(await member.get<{ saved: boolean }>(`/saved-movies/${project.id}`)).toEqual({ saved: true });
    const saved = await member.get<{ id: string }[]>('/saved-movies');
    expect(saved.map((movie) => movie.id)).toContain(project.id);

    await member.call('delete', `/saved-movies/${project.id}`);
    expect(await member.get<{ saved: boolean }>(`/saved-movies/${project.id}`)).toEqual({ saved: false });
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
    const created = await admin.post<{ id: string; status: string; durationSeconds: number }>('/admin/ads', {
      title: `Trà sữa e2e ${Date.now()}`,
      mediaUrl: 'https://cdn.aicinema.example/public/ads/e2e-15s.mp4',
      weight: 2,
    });
    // The length is read from the video (the mocked probe answers 60 s); the Admin never types it.
    expect(created).toMatchObject({ status: 'ACTIVE', durationSeconds: 60 });
    await admin.post(
      '/admin/ads',
      { title: 'Có thời lượng', mediaUrl: 'https://cdn.aicinema.example/a.mp4', durationSeconds: 15 },
      400,
    );
    await admin.patch(`/admin/ads/${created.id}`, { status: 'PAUSED' }, 200);

    // An ad video uploaded from the computer comes back as a public link the ad is created with.
    const uploaded = await admin.upload<{ mediaUrl: string }>('/admin/ads/media', {
      field: 'file',
      name: 'quang-cao.mp4',
      content: MP4,
    });
    expect(uploaded.mediaUrl).toMatch(/\/ads\/[0-9a-f-]{36}\.mp4$/);
    await admin.post('/admin/ads', { title: `Upload e2e ${Date.now()}`, mediaUrl: uploaded.mediaUrl }, 201);
    await admin.upload('/admin/ads/media', { field: 'file', name: 'quang-cao.mov', content: MP4 }, {}, 400);
    await member.upload('/admin/ads/media', { field: 'file', name: 'quang-cao.mp4', content: MP4 }, {}, 403);

    const session = await member.post<SessionView>('/playback/sessions', { episodeId: episodeId(0) }, 201);
    const token = new URL(session.stream.masterUrl);
    expect(token.pathname).toContain('/media/');
    await member.get(
      `/playback/s/${session.sessionId}/master.m3u8?s=${session.sessionId}&exp=2000000000&sig=${'0'.repeat(64)}`,
      422,
    );
    await member.post(
      `/playback/sessions/${session.sessionId}/ad-breaks/00000000-0000-4000-8000-000000000000/played`,
      { positionSeconds: 0 },
      404,
    );
    await member.post(
      `/playback/sessions/${session.sessionId}/ad-breaks/00000000-0000-4000-8000-000000000000/completed`,
      {},
      404,
    );
  });

  it('admin places where and how many ads an episode gets; a seek past a cue still plays it (BR-32/33)', async () => {
    const ad = await admin.post<{ id: string }>('/admin/ads', {
      title: `Ghim e2e ${Date.now()}`,
      mediaUrl: 'https://cdn.aicinema.example/public/ads/pinned-15s.mp4',
    });
    const slotsPath = `/admin/episodes/${episodeId(0)}/ad-slots`;
    // The mock episodes last 60s: a cue at the very end is refused.
    await admin.put(slotsPath, { slots: [{ positionSeconds: 60 }] }, 400);
    const placed = await admin.put<{ mode: string; slots: { positionSeconds: number }[] }>(slotsPath, {
      slots: [{ positionSeconds: 40 }, { positionSeconds: 20, adId: ad.id }],
    });
    expect(placed).toMatchObject({ mode: 'MANUAL', slots: [{ positionSeconds: 20 }, { positionSeconds: 40 }] });

    const viewer = randomUUID();
    const asGuest = async <T>(method: 'post' | 'patch', path: string, body: object, status: number): Promise<T> => {
      const res = await request(app.getHttpServer())[method](`/api${path}`).set('X-Guest-Key', viewer).send(body);
      expect(res.status).toBe(status);
      return res.body as T;
    };
    const session = await asGuest<
      SessionView & { adSchedule: { breakId: string; positionSeconds: number; ad: { id: string } }[] }
    >('post', '/playback/sessions', { episodeId: episodeId(0) }, 201);
    expect(session.adSchedule.map((cue) => cue.positionSeconds)).toEqual([20, 40]);
    expect(session.adSchedule[0].ad.id).toBe(ad.id);

    // A seek straight to 45s jumps both cues: the heartbeat names the last one, which plays now.
    const beat = await asGuest<{ dueAdBreakId: string | null }>(
      'patch',
      `/playback/sessions/${session.sessionId}/heartbeat`,
      { positionSeconds: 45 },
      200,
    );
    expect(beat.dueAdBreakId).toBe(session.adSchedule[1].breakId);
    const played = await asGuest<{ status: string }>(
      'post',
      `/playback/sessions/${session.sessionId}/ad-breaks/${beat.dueAdBreakId}/played`,
      { positionSeconds: 45 },
      201,
    );
    expect(played.status).toBe('COMPLETED');
    // The earlier cue was skipped, so nothing is due any more.
    const after = await asGuest<{ dueAdBreakId: string | null }>(
      'patch',
      `/playback/sessions/${session.sessionId}/heartbeat`,
      { positionSeconds: 46 },
      200,
    );
    expect(after.dueAdBreakId).toBeNull();

    await expect(admin.put(slotsPath, { slots: [] })).resolves.toMatchObject({ mode: 'RANDOM', slots: [] });
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
