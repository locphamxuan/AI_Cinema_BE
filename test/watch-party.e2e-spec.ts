import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, priceEpisode, release } from './support/media';
import { registerMember } from './support/members';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Room {
  id: string;
  roomCode: string;
  episodeId: string;
  hostUserId: string;
  status: string;
  currentPositionSeconds: number;
  participantCount: number;
  serverTimestamp: number;
}

/** BR-69 Watch Party over REST (the gateway is covered by unit tests) and BR-68 recommendations. */
describe('Watch party and recommendations (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let member: Actor;
  let admin: Actor;
  let project: ProjectDetail;
  const episodeId = (i: number) => episodesOf(project)[i].id;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, member, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'member01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Hai người bạn cùng xem lại những thước phim cũ của thành phố.',
      ageRating: 'T16',
    });
    for (let i = 0; i < 2; i += 1) {
      await compliantEpisode(reviewer, creator, episodeId(i));
      // Episode 1 is free for everyone; episode 2 is paid until the Admin frees it for members.
      await priceEpisode(reviewer, episodeId(i), 10, { isFreeForGuest: i === 0 });
      await release(reviewer, `/episodes/${episodeId(i)}/publications`, {});
    }
  }, 120000);

  afterAll(() => app.close());

  it('refuses a room on an episode the Host may not watch (paywall gate, edge 1.1)', async () => {
    const refused = await member.post<{ error: { details: { reason: string } } }>(
      '/watch-rooms',
      { episodeId: episodeId(1) },
      403,
    );
    expect(refused.error.details.reason).toBe('ENTITLEMENT_REQUIRED');
  });

  it('runs a room: create, join by code, Host-only sync, next episode, transfer and disband', async () => {
    const room = await member.post<Room>('/watch-rooms', { episodeId: episodeId(0) }, 201);
    expect(room.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);

    // Codes are case- and dash-insensitive; a wrong one is a plain 404.
    const joined = await admin.post<Room>('/watch-rooms/join', { roomCode: room.roomCode.toLowerCase() }, 200);
    expect(joined.participantCount).toBe(2);
    await admin.post('/watch-rooms/join', { roomCode: 'ZZZ-ZZZ' }, 404);

    // Only the Host drives the clock; a late reader gets it extrapolated with the server time.
    await admin.call('put', `/watch-rooms/${room.id}`, { state: 'PLAYING', positionSeconds: 5 }, 403);
    await member.call('put', `/watch-rooms/${room.id}`, { state: 'PLAYING', positionSeconds: 30 }, 200);
    const snapshot = await admin.get<Room>(`/watch-rooms/${room.id}`);
    expect(snapshot.status).toBe('PLAYING');
    expect(snapshot.currentPositionSeconds).toBeGreaterThanOrEqual(30);
    expect(snapshot.serverTimestamp).toEqual(expect.any(Number));
    await reviewer.get(`/watch-rooms/${room.id}`, 403);

    // The Host cannot move the room to a paid episode it has no right to; once members may watch it, it moves.
    await member.post(`/watch-rooms/${room.id}/next-episode`, {}, 403);
    await priceEpisode(reviewer, episodeId(1), 10, { isFreeForMember: true });
    const moved = await member.post<Room & { blockedUserIds: string[] }>(
      `/watch-rooms/${room.id}/next-episode`,
      {},
      200,
    );
    expect(moved).toMatchObject({ episodeId: episodeId(1), status: 'PAUSED', blockedUserIds: [] });
    await admin.post(`/watch-rooms/${room.id}/next-episode`, {}, 403);

    // A leaving Host hands the room to the earliest member; that Host then closes it for everyone.
    const handed = await member.post<{ closed: boolean; newHostUserId: string }>(
      `/watch-rooms/${room.id}/leave`,
      {},
      200,
    );
    expect(handed.closed).toBe(false);
    const closed = await admin.post<{ closed: boolean }>(`/watch-rooms/${room.id}/leave`, { action: 'DISBAND' }, 200);
    expect(closed.closed).toBe(true);
    await member.post(`/watch-rooms/${room.id}/join`, {}, 409);
  });

  it('recommends to a member and shows trending titles to a guest (BR-68)', async () => {
    const forYou = await member.get<{ movieId: string; source: string }[]>('/recommendations/for-you');
    expect(Array.isArray(forYou)).toBe(true);
    expect(forYou.every((r) => r.source === 'hybrid')).toBe(true);

    const trending = await request(app.getHttpServer()).get('/api/recommendations/trending').expect(200);
    const rows = trending.body as { movieId: string; ageRating: string | null; source: string; score: number }[];
    // Other suites publish movies too: assert the ranking, not where this project lands in it.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score)).toBe(true);
    expect(rows.every((r) => r.ageRating !== 'T18' && r.source === 'trending')).toBe(true);
  });

  it('reads viewing behavior: a movie watched to the end leaves the list and shapes the next picks (BR-68)', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
    try {
      await prisma.watchProgress.upsert({
        where: { userId_episodeId: { userId: member.id, episodeId: episodeId(0) } },
        create: {
          userId: member.id,
          episodeId: episodeId(0),
          positionSeconds: 600,
          durationSeconds: 600,
          completed: true,
        },
        update: { positionSeconds: 600, durationSeconds: 600, completed: true },
      });
    } finally {
      await prisma.$disconnect();
    }
    const forYou = await member.get<{ movieId: string; reason: string }[]>('/recommendations/for-you');
    expect(forYou.some((r) => r.movieId === project.id)).toBe(false);
    expect(forYou.every((r) => typeof r.reason === 'string')).toBe(true);

    const after = await member.get<{ movieId: string; source: string }[]>(`/recommendations/after/${project.id}`);
    expect(after.every((r) => r.movieId !== project.id && r.source === 'after')).toBe(true);
    await member.get('/recommendations/after/00000000-0000-4000-8000-000000000000', 404);
    await member.get('/recommendations/after/not-a-uuid', 400);
  });

  it('shows similar movies on a movie page to guests, never the movie itself', async () => {
    const res = await request(app.getHttpServer()).get(`/api/recommendations/similar/${project.id}`).expect(200);
    const rows = res.body as { movieId: string; source: string; ageRating: string | null }[];
    expect(rows.every((r) => r.movieId !== project.id && r.source === 'similar' && r.ageRating !== 'T18')).toBe(true);
    await request(app.getHttpServer())
      .get('/api/recommendations/similar/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('adds, accepts, lists, blocks and unblocks a friend (BR-69 invites)', async () => {
    const friend = await registerMember(app);
    await member.post('/friends', {}, 400);
    const sent = await member.post<{ id: string; status: string }>('/friends', { receiverId: friend.id });
    expect(sent.status).toBe('PENDING');
    await friend.post(`/friends/${sent.id}/respond`, {}, 400);
    const accepted = await friend.post<{ status: string }>(`/friends/${sent.id}/respond`, { accept: true }, 201);
    expect(accepted.status).toBe('ACCEPTED');
    const friends = await member.get<{ id: string }[]>('/friends');
    expect(friends.some((f) => f.id === sent.id)).toBe(true);
    await member.post('/friends', { receiverId: member.id }, 403);
    await member.post('/friends', { receiverId: '00000000-0000-4000-8000-000000000000' }, 404);
    await member.post('/friends', { receiverId: friend.id }, 409);
    await friend.post('/friends', { receiverId: member.id }, 409);
    await member.post(`/friends/${sent.id}/respond`, { accept: true }, 403);
    await friend.post(`/friends/${sent.id}/respond`, { accept: true }, 409);
    await friend.post('/friends/00000000-0000-4000-8000-000000000000/respond', { accept: true }, 404);
    await member.get('/friends?status=ACCEPTED');

    const stranger = await registerMember(app);
    const asked = await stranger.post<{ id: string }>('/friends', { receiverId: member.id });
    const refused = await member.post<{ status: string }>(`/friends/${asked.id}/respond`, { accept: false }, 201);
    expect(refused.status).toBe('BLOCKED');
    await stranger.post('/friends', { receiverId: member.id }, 403);

    await member.post(`/friends/${friend.id}/block`, {}, 201);
    await member.call('delete', `/friends/${friend.id}/block`);
  });
});
