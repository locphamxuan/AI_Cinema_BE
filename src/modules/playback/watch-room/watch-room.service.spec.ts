import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WatchRoomStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import type { RoomJoinGuard } from './room-join.guard';
import { WatchRoomService } from './watch-room.service';
import { WatchRoomResponseDto } from './dto/watch-room.dto';

describe('WatchRoomService', () => {
  const prisma = {
    episode: { findUnique: jest.fn(), findFirst: jest.fn() },
    watchRoom: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    roomParticipant: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const guard = { assertMayJoin: jest.fn() };
  const entitlement = { canWatch: jest.fn() };
  const newService = () =>
    new WatchRoomService(
      prisma as unknown as PrismaService,
      guard as unknown as RoomJoinGuard,
      entitlement as unknown as WatchEntitlementService,
    );

  const host = { id: 'p1', roomId: 'r1', userId: 'u1', role: 'HOST', leftAt: null, joinedAt: new Date(1000) };
  const member = { id: 'p2', roomId: 'r1', userId: 'u2', role: 'PARTICIPANT', leftAt: null, joinedAt: new Date(2000) };
  const room = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    roomCode: 'ABCDEG',
    episodeId: 'ep-1',
    hostUserId: 'u1',
    status: WatchRoomStatus.CREATED,
    currentPositionSeconds: 0,
    lastHostPingAt: null,
    expiresAt: null,
    participants: [host],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    guard.assertMayJoin.mockResolvedValue(undefined);
  });

  it('creates a room with a unique code once the Host passes the paywall gate', async () => {
    prisma.episode.findUnique.mockResolvedValue({ id: 'ep-1', movieId: 'm1' });
    prisma.watchRoom.findUnique.mockResolvedValue(null);
    prisma.watchRoom.create.mockResolvedValue(room());
    prisma.roomParticipant.create.mockResolvedValue({});
    const res = await newService().create('u1', { episodeId: 'ep-1' });
    expect(guard.assertMayJoin).toHaveBeenCalledWith('u1', 'ep-1');
    expect(res).toBeInstanceOf(WatchRoomResponseDto);
    expect(res.participantCount).toBe(1);
  });

  it('returns 404 for a missing episode', async () => {
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(newService().create('u1', { episodeId: 'missing' })).rejects.toThrow(NotFoundException);
  });

  it('lets a member join through the door checks and counts active participants', async () => {
    prisma.watchRoom.findUnique.mockResolvedValueOnce(room());
    prisma.watchRoom.findUnique.mockResolvedValueOnce(room({ participants: [host, member] }));
    prisma.roomParticipant.create.mockResolvedValue({});
    const res = await newService().join('u2', 'r1');
    expect(guard.assertMayJoin).toHaveBeenCalledWith('u2', 'ep-1', expect.objectContaining({ id: 'r1' }));
    expect(res.participantCount).toBe(2);
    expect(res.serverTimestamp).toEqual(expect.any(Number));
  });

  it('refuses the join when a door check refuses (edge 1.1)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    guard.assertMayJoin.mockRejectedValue(new ForbiddenException({ details: { reason: 'ENTITLEMENT_REQUIRED' } }));
    await expect(newService().join('u2', 'r1')).rejects.toThrow(ForbiddenException);
    expect(prisma.roomParticipant.create).not.toHaveBeenCalled();
  });

  it('refuses to join a closed room', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ status: WatchRoomStatus.ENDED }));
    await expect(newService().join('u2', 'r1')).rejects.toThrow(ConflictException);
  });

  it('joins by code, dashes and case ignored (edge 4.1)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValueOnce(room());
    prisma.watchRoom.findUnique.mockResolvedValueOnce(room({ participants: [host, member] }));
    prisma.roomParticipant.create.mockResolvedValue({});
    await newService().joinByCode('u2', 'abc-deg');
    expect(prisma.watchRoom.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { roomCode: 'ABCDEG' } }),
    );
  });

  it('locks a member out after five wrong codes (edge 4.1)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(null);
    const service = newService();
    for (let i = 0; i < 5; i++) {
      await expect(service.joinByCode('u2', `WRONG${i}`)).rejects.toThrow(NotFoundException);
    }
    await expect(service.joinByCode('u2', 'ABCDEG')).rejects.toThrow(ForbiddenException);
  });

  it('refuses a non-participant from reading the room', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    await expect(newService().detail('u3', 'r1')).rejects.toThrow(ForbiddenException);
  });

  it('lets the Host sync the clock and extrapolates the snapshot while playing (edge 2.1)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    prisma.watchRoom.update.mockResolvedValue(
      room({
        status: WatchRoomStatus.PLAYING,
        currentPositionSeconds: 120,
        lastHostPingAt: new Date(Date.now() - 10_000),
      }),
    );
    const res = await newService().hostSync('u1', 'r1', { state: 'PLAYING', positionSeconds: 120 });
    expect(res.status).toBe('PLAYING');
    expect(res.currentPositionSeconds).toBeGreaterThanOrEqual(129);
  });

  it('refuses a non-Host from syncing (edge 2.4)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ participants: [host, member] }));
    await expect(newService().hostSync('u2', 'r1', { state: 'PLAYING', positionSeconds: 0 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('disbands the room when the Host leaves alone', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    prisma.roomParticipant.update.mockResolvedValue({});
    prisma.watchRoom.update.mockResolvedValue({});
    const res = await newService().leave('u1', 'r1');
    expect(res.closed).toBe(true);
    expect(prisma.watchRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISBANDED' }) }),
    );
  });

  it('hands the seat to the earliest member when the Host leaves without a choice (edge 3.2)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ participants: [host, member] }));
    prisma.roomParticipant.update.mockResolvedValue({});
    prisma.roomParticipant.updateMany.mockResolvedValue({});
    prisma.watchRoom.update.mockResolvedValue({});
    const res = await newService().leave('u1', 'r1');
    expect(res).toEqual({ closed: false, newHostUserId: 'u2' });
  });

  it('disbands for everyone when the Host chooses so (edge 3.2)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ participants: [host, member] }));
    prisma.roomParticipant.update.mockResolvedValue({});
    prisma.watchRoom.update.mockResolvedValue({});
    const res = await newService().leave('u1', 'r1', { action: 'DISBAND' });
    expect(res.closed).toBe(true);
  });

  it('moves the room to the next episode and lets the unentitled go (edges 1.2, 3.5)', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ participants: [host, member] }));
    prisma.episode.findUnique.mockResolvedValue({ movieId: 'm1', episodeNumber: 1 });
    prisma.episode.findFirst.mockResolvedValue({ id: 'ep-2', episodeNumber: 2 });
    entitlement.canWatch.mockImplementation((episodeId: string, userId: string) =>
      Promise.resolve(userId === 'u1' ? { allowed: true } : { allowed: false, required: { coinPrice: 10 } }),
    );
    prisma.roomParticipant.update.mockResolvedValue({});
    prisma.watchRoom.update.mockResolvedValue(room({ episodeId: 'ep-2', status: WatchRoomStatus.PAUSED }));
    const res = await newService().nextEpisode('u1', 'r1');
    expect(res.blockedUserIds).toEqual(['u2']);
    expect(res.room.episodeId).toBe('ep-2');
  });

  it('refuses the next episode when the Host is not entitled to it', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ participants: [host, member] }));
    prisma.episode.findUnique.mockResolvedValue({ movieId: 'm1', episodeNumber: 1 });
    prisma.episode.findFirst.mockResolvedValue({ id: 'ep-2', episodeNumber: 2 });
    entitlement.canWatch.mockResolvedValue({ allowed: false, required: { coinPrice: 10 } });
    await expect(newService().nextEpisode('u1', 'r1')).rejects.toThrow(ForbiddenException);
    expect(prisma.watchRoom.update).not.toHaveBeenCalled();
    // A refused move never sends a member out of the room.
    expect(prisma.roomParticipant.update).not.toHaveBeenCalled();
  });

  it('terminates every open room of a taken-down episode (edge 1.4)', async () => {
    prisma.watchRoom.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    prisma.watchRoom.updateMany.mockResolvedValue({ count: 2 });
    const ids = await newService().terminateByEpisode('ep-1');
    expect(ids).toEqual(['r1', 'r2']);
    expect(prisma.watchRoom.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISBANDED' }) }),
    );
  });
});
