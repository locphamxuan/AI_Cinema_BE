import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { APP_CONFIG, loadConfig } from 'src/config/app-config';
import { ROOM_EVENT } from 'src/modules/playback/watch-room/room-events';
import { E2E_REDIS_URL } from './e2e-env';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, priceEpisode, release } from './support/media';
import { episodesOf, projectInProduction } from './support/projects';

/**
 * Two API instances behind one Redis (socket.io Redis adapter + RoomCluster): the Host plays on
 * instance A, a member watches on instance B, and both see the same room.
 */
describe('Watch room across two API instances (e2e)', () => {
  let a: INestApplication<App>;
  let b: INestApplication<App>;
  const sockets: Socket[] = [];

  const urlOf = (app: INestApplication<App>) =>
    `http://127.0.0.1:${(app.getHttpServer() as unknown as { address(): AddressInfo }).address().port}/watch`;

  async function member(app: INestApplication<App>): Promise<{ token: string; actor: Actor }> {
    const email = `cluster-${randomUUID()}@aicinema.test`;
    const password = 'Member@123';
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, fullName: 'Thành viên cụm', dateOfBirth: '2000-01-01' })
      .expect(201);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
    return { token: (login.body as { accessToken: string }).accessToken, actor: await signIn(app, email, password) };
  }

  function connect(app: INestApplication<App>, token: string): Promise<Socket> {
    const socket = io(urlOf(app), { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const next = <T>(socket: Socket, event: string, timeoutMs = 5000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event}`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  /** An API instance on Redis: the process-wide config was read without it, so this one is read again. */
  async function bootOnRedis(): Promise<INestApplication<App>> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ ...process.env, REDIS_URL: E2E_REDIS_URL }))
      .compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return app;
  }

  /** The socket handshake is verified asynchronously: give it a moment before the first event. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  let episodeId: string;

  beforeAll(async () => {
    // The episode is made ready inline (no Redis: media jobs run inside the request), then the two
    // instances start on Redis.
    const setup = await bootApp();
    const [reviewer, creator] = await Promise.all([
      signIn(setup, 'reviewer01@aicinema.com'),
      signIn(setup, 'creator01@aicinema.com'),
    ]);
    const project = await projectInProduction(reviewer, creator, 1);
    episodeId = episodesOf(project)[0].id;
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Hai người bạn ở hai thành phố cùng xem một bộ phim.',
      ageRating: 'T16',
    });
    await compliantEpisode(reviewer, creator, episodeId);
    await priceEpisode(reviewer, episodeId, 10, { isFreeForGuest: true });
    await release(reviewer, `/episodes/${episodeId}/publications`, {});
    await setup.close();

    [a, b] = await Promise.all([bootOnRedis(), bootOnRedis()]);
  }, 120000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    // Let both instances handle the drops (Host grace, PARTICIPANT_LEFT) while Redis is still up.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([a?.close(), b?.close()]);
  });

  it('syncs the Host clock, the chat and the quality from instance A to a member on instance B', async () => {
    const host = await member(a);
    const viewer = await member(b);
    const room = await host.actor.post<{ id: string; roomCode: string }>('/watch-rooms', { episodeId });
    await viewer.actor.post('/watch-rooms/join', { roomCode: room.roomCode }, 200);

    const hostSocket = await connect(a, host.token);
    const viewerSocket = await connect(b, viewer.token);
    await settle();
    const hostJoined = next(hostSocket, ROOM_EVENT.JOINED);
    hostSocket.emit(ROOM_EVENT.JOIN, { roomId: room.id });
    await hostJoined;
    const viewerJoined = next(viewerSocket, ROOM_EVENT.JOINED);
    const seenByHost = next<{ userId: string }>(hostSocket, ROOM_EVENT.PARTICIPANT_JOINED);
    viewerSocket.emit(ROOM_EVENT.JOIN, { roomId: room.id });
    await viewerJoined;
    // A broadcast made on B reaches the Host's socket on A.
    await expect(seenByHost).resolves.toMatchObject({ userId: viewer.actor.id });

    const synced = next<{ state: string; positionSeconds: number }>(viewerSocket, ROOM_EVENT.SYNC_PLAYBACK);
    hostSocket.emit(ROOM_EVENT.PLAYBACK, { roomId: room.id, state: 'PLAYING', positionSeconds: 30 });
    await expect(synced).resolves.toMatchObject({ state: 'PLAYING', positionSeconds: 30 });

    // B's own heartbeat now runs the Host clock it learned from A (not a stale copy from the database).
    const beat = await next<{ state: string; positionSeconds: number }>(viewerSocket, ROOM_EVENT.HEARTBEAT_SYNC, 7000);
    expect(beat.state).toBe('PLAYING');
    expect(beat.positionSeconds).toBeGreaterThanOrEqual(30);

    const chat = next<{ text: string }>(viewerSocket, ROOM_EVENT.CHAT_MESSAGE);
    hostSocket.emit(ROOM_EVENT.CHAT, { roomId: room.id, text: 'Xem từ máy A' });
    await expect(chat).resolves.toMatchObject({ text: 'Xem từ máy A' });
    const quality = next<{ quality: string }>(viewerSocket, ROOM_EVENT.QUALITY_CHANGED);
    hostSocket.emit(ROOM_EVENT.QUALITY, { roomId: room.id, quality: '480p' });
    await expect(quality).resolves.toEqual({ quality: '480p' });

    // A member catching up on B gets the chat and the quality chosen on A.
    const screen = next<{ quality: string; chat: { text: string }[] }>(viewerSocket, ROOM_EVENT.SCREEN);
    viewerSocket.emit(ROOM_EVENT.SCREEN_STATE, { roomId: room.id });
    await expect(screen).resolves.toMatchObject({ quality: '480p', chat: [{ text: 'Xem từ máy A' }] });
  }, 120000);
});
