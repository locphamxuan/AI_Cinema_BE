import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WatchRoomStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchRoomService } from './watch-room.service';
import { WatchRoomResponseDto } from './dto/watch-room.dto';

describe('WatchRoomService', () => {
  const prisma = {
    episode: { findUnique: jest.fn() },
    watchRoom: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    roomParticipant: { create: jest.fn(), update: jest.fn() },
  };
  const service = new WatchRoomService(prisma as unknown as PrismaService);

  const episode = { id: 'ep-1', movieId: 'm1' };
  const room = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    roomCode: 'ABCDEFG',
    episodeId: 'ep-1',
    hostUserId: 'u1',
    status: WatchRoomStatus.CREATED,
    currentPositionSeconds: 0,
    participants: [{ id: 'p1', roomId: 'r1', userId: 'u1', role: 'HOST', leftAt: null }],
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates a room with a unique code and the caller as Host', async () => {
    prisma.episode.findUnique.mockResolvedValue(episode);
    prisma.watchRoom.create.mockResolvedValue(room());
    prisma.roomParticipant.create.mockResolvedValue({});
    const res = await service.create('u1', { episodeId: 'ep-1' });
    expect(prisma.watchRoom.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomCode: expect.any(String), hostUserId: 'u1' }) }),
    );
    expect(prisma.roomParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: 'r1', userId: 'u1', role: 'HOST' }) }),
    );
    expect(res).toBeInstanceOf(WatchRoomResponseDto);
    expect(res.participantCount).toBe(1);
  });

  it('returns 404 for a missing episode', async () => {
    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(service.create('u1', { episodeId: 'missing' })).rejects.toThrow(NotFoundException);
  });

  it('lets a member join and counts participants', async () => {
    prisma.watchRoom.findUnique.mockResolvedValueOnce(room({ participants: [room().participants[0]] }));
    prisma.watchRoom.findUnique.mockResolvedValueOnce(
      room({ participants: [room().participants[0], { id: 'p2', roomId: 'r1', userId: 'u2', role: 'PARTICIPANT', leftAt: null }] }),
    );
    prisma.roomParticipant.create.mockResolvedValue({});
    const res = await service.join('u2', 'r1');
    expect(res.participantCount).toBe(2);
  });

  it('refuses to join a closed room', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room({ status: WatchRoomStatus.ENDED }));
    await expect(service.join('u2', 'r1')).rejects.toThrow(ConflictException);
  });

  it('refuses a non-participant from reading the room', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    await expect(service.detail('u3', 'r1')).rejects.toThrow(ForbiddenException);
  });

  it('lets the Host sync the clock and state', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    prisma.watchRoom.update.mockResolvedValue(room({ status: WatchRoomStatus.PLAYING, currentPositionSeconds: 120 }));
    const res = await service.hostSync('u1', 'r1', { state: 'PLAYING', positionSeconds: 120 });
    expect(prisma.watchRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: WatchRoomStatus.PLAYING, currentPositionSeconds: 120 }) }),
    );
    expect(res.status).toBe('PLAYING');
  });

  it('refuses a non-Host from syncing', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(
      room({ participants: [{ id: 'p1', roomId: 'r1', userId: 'u1', role: 'HOST', leftAt: null }, { id: 'p2', roomId: 'r1', userId: 'u2', role: 'PARTICIPANT', leftAt: null }] }),
    );
    await expect(service.hostSync('u2', 'r1', { state: 'PLAYING', positionSeconds: 0 })).rejects.toThrow(ForbiddenException);
  });

  it('disbands the room when the Host leaves alone', async () => {
    prisma.watchRoom.findUnique.mockResolvedValue(room());
    prisma.roomParticipant.update.mockResolvedValue({});
    prisma.watchRoom.update.mockResolvedValue({});
    await service.leave('u1', 'r1');
    expect(prisma.watchRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: WatchRoomStatus.DISBANDED }) }),
    );
  });
});