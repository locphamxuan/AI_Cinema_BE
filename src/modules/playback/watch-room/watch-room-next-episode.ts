import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VISIBLE_EPISODE } from 'src/modules/catalog/episode-visibility';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import { ROOM_TTL_MS, assertNotDisbanded, roomSnapshot } from './room-state';
import type { WatchRoomResponseDto } from './dto/watch-room.dto';

/** Re-checks every participant before moving the room to the next published episode. */
export async function advanceRoomEpisode(
  prisma: PrismaService,
  entitlement: WatchEntitlementService,
  userId: string,
  roomId: string,
  assertCanUse: () => Promise<void>,
): Promise<{ room: WatchRoomResponseDto; blockedUserIds: string[] }> {
  const room = await prisma.watchRoom.findUnique({
    where: { id: roomId },
    include: { participants: { include: { participant: { select: { fullName: true } } } } },
  });
  if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
  if (room.hostUserId !== userId) {
    throw new ForbiddenException({ message: 'Only the Host may continue', details: { reason: 'NOT_HOST' } });
  }
  if (
    !room.participants.some(
      (participant) => participant.userId === userId && participant.role === 'HOST' && !participant.leftAt,
    )
  ) {
    throw new ForbiddenException({ message: 'Only the Host may continue', details: { reason: 'NOT_HOST' } });
  }
  await assertCanUse();
  assertNotDisbanded(room);

  const current = await prisma.episode.findUnique({
    where: { id: room.episodeId },
    select: { movieId: true, episodeNumber: true },
  });
  const next =
    current &&
    (await prisma.episode.findFirst({
      where: { movieId: current.movieId, episodeNumber: { gt: current.episodeNumber }, ...VISIBLE_EPISODE },
      orderBy: { episodeNumber: 'asc' },
    }));
  if (!next) throw new NotFoundException({ message: 'No next episode', details: { reason: 'NO_NEXT_EPISODE' } });

  const active = room.participants.filter((participant) => !participant.leftAt);
  const checks = await Promise.all(
    active.map(async (participant) => ({
      participant,
      check: await entitlement.canWatch(next.id, participant.userId),
    })),
  );
  const hostCheck = checks.find(({ participant }) => participant.userId === userId);
  if (hostCheck && !hostCheck.check.allowed) {
    throw new ForbiddenException({
      message: 'Unlock the next episode before playing it for the room',
      details: { reason: 'ENTITLEMENT_REQUIRED', required: hostCheck.check.required },
    });
  }
  const blocked = checks.filter(({ participant, check }) => !check.allowed && participant.userId !== userId);
  await Promise.all(
    blocked.map(({ participant }) =>
      prisma.roomParticipant.update({ where: { id: participant.id }, data: { leftAt: new Date() } }),
    ),
  );

  const updated = await prisma.watchRoom.update({
    where: { id: roomId },
    data: {
      episodeId: next.id,
      currentPositionSeconds: 0,
      status: 'PAUSED',
      lastHostPingAt: new Date(),
      expiresAt: new Date(Date.now() + ROOM_TTL_MS),
    },
    include: { participants: { include: { participant: { select: { fullName: true } } } } },
  });
  return { room: roomSnapshot(updated), blockedUserIds: blocked.map(({ participant }) => participant.userId) };
}
