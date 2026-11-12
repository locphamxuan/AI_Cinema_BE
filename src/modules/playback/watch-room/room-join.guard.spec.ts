import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import { RoomJoinGuard } from './room-join.guard';
import { ROOM_CAPACITY } from './room-events';

describe('RoomJoinGuard', () => {
  const prisma = {
    episode: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    friendship: { count: jest.fn() },
    streamingSession: { findMany: jest.fn() },
  };
  const entitlement = { canWatch: jest.fn() };
  const playbackAccess = { runningPlanOf: jest.fn(), freePlanOf: jest.fn() };
  const settings = { get: jest.fn() };
  const guard = new RoomJoinGuard(
    prisma as unknown as PrismaService,
    entitlement as unknown as WatchEntitlementService,
    playbackAccess as unknown as PlaybackAccessService,
    settings as unknown as PlatformSettingService,
  );
  const room = (count = 1) => ({
    hostUserId: 'host',
    participants: Array.from({ length: count }, (_, i) => ({ userId: `m${i}`, leftAt: null })),
  });
  const reasonOf = async (p: Promise<unknown>) =>
    p.catch((e: { getResponse: () => { details: { reason: string } } }) => e.getResponse().details.reason);

  beforeEach(() => {
    jest.clearAllMocks();
    entitlement.canWatch.mockResolvedValue({ allowed: true });
    prisma.episode.findUnique.mockResolvedValue({ movie: { ageRating: 'P' } });
    prisma.friendship.count.mockResolvedValue(0);
    prisma.streamingSession.findMany.mockResolvedValue([]);
    playbackAccess.runningPlanOf.mockResolvedValue(null);
    playbackAccess.freePlanOf.mockResolvedValue({ code: 'FREE', features: { maxConcurrentStreams: 2 } });
    settings.get.mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 60 });
  });

  it('admits an entitled adult into a room with space', async () => {
    await expect(guard.assertMayJoin('u1', 'ep', room())).resolves.toBeUndefined();
  });

  it('refuses a member without a right to the episode, with the paywall info (edge 1.1)', async () => {
    entitlement.canWatch.mockResolvedValue({ allowed: false, reason: 'UNLOCK_EPISODE', required: { coinPrice: 10 } });
    const p = guard.assertMayJoin('u1', 'ep', room());
    await expect(p).rejects.toThrow(ForbiddenException);
    expect(await reasonOf(guard.assertMayJoin('u1', 'ep', room()))).toBe('ENTITLEMENT_REQUIRED');
  });

  it('refuses a minor or unconfirmed account at a T18 room (edge 6.2)', async () => {
    prisma.episode.findUnique.mockResolvedValue({ movie: { ageRating: 'T18' } });
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: null });
    expect(await reasonOf(guard.assertMayJoin('u1', 'ep', room()))).toBe('AGE_RESTRICTED');
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    await expect(guard.assertMayJoin('u1', 'ep', room())).resolves.toBeUndefined();
  });

  it('refuses the member after the capacity, but lets a member already in come back (edge 4.2)', async () => {
    await expect(guard.assertMayJoin('new', 'ep', room(ROOM_CAPACITY))).rejects.toThrow(ConflictException);
    await expect(guard.assertMayJoin('m0', 'ep', room(ROOM_CAPACITY))).resolves.toBeUndefined();
  });

  it('hides the room from a member blocked by or blocking the Host (edge 7.3)', async () => {
    prisma.friendship.count.mockResolvedValue(1);
    await expect(guard.assertMayJoin('u1', 'ep', room())).rejects.toThrow(NotFoundException);
  });

  it('refuses with 409 DEVICE_LIMIT_EXCEEDED and the live devices at the stream cap (edge 5.1)', async () => {
    prisma.streamingSession.findMany.mockResolvedValue([
      { deviceId: 'd1', device: { id: 'd1', name: 'Smart TV', platform: 'OTHER' } },
      { deviceId: 'd2', device: { id: 'd2', name: 'Web', platform: 'WEB' } },
    ]);
    const err = (await guard.assertMayJoin('u1', 'ep', room()).catch((e: unknown) => e)) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      details: { reason: 'DEVICE_LIMIT_EXCEEDED', maxConcurrentStreams: 2, devices: [{ id: 'd1' }, { id: 'd2' }] },
    });
  });
});
