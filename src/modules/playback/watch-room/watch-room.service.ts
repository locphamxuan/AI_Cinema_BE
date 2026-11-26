import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import { CodeGuessLimiter, generateRoomCode, normalizeRoomCode } from './room-codes';
import { RoomJoinGuard } from './room-join.guard';
import { WatchRoomResponseDto } from './dto/watch-room.dto';
import { assertNotDisbanded, assertOpen, ROOM_TTL_MS, roomSnapshot } from './room-state';
import { advanceRoomEpisode } from './watch-room-next-episode';

type RoomWithParticipants = NonNullable<Awaited<ReturnType<WatchRoomService['findRoom']>>>;

@Injectable()
export class WatchRoomService {
  private readonly logger = new Logger(WatchRoomService.name);
  private readonly codeGuesses = new CodeGuessLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: RoomJoinGuard,
    private readonly entitlement: WatchEntitlementService,
  ) {}

  /** Used by REST and socket actions after a room has already been opened. */
  assertCanUse(userId: string): Promise<void> {
    return this.guard.assertActiveMonthlyPlan(userId);
  }

  /** The Host, too, passes the paywall gate: a room never starts on an episode its Host cannot watch. */
  async create(userId: string, dto: { episodeId: string }, deviceKey?: string): Promise<WatchRoomResponseDto> {
    const episode = await this.prisma.episode.findUnique({ where: { id: dto.episodeId } });
    if (!episode)
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    await this.guard.assertMayJoin(userId, dto.episodeId, undefined, deviceKey);

    const roomCode = await this.uniqueRoomCode();
    const room = await this.prisma.watchRoom.create({
      data: {
        roomCode,
        episodeId: dto.episodeId,
        hostUserId: userId,
        status: 'CREATED',
        currentPositionSeconds: 0,
        expiresAt: new Date(Date.now() + ROOM_TTL_MS),
      },
      include: { participants: true },
    });
    await this.prisma.roomParticipant.create({ data: { roomId: room.id, userId, role: 'HOST' } });
    return WatchRoomResponseDto.from(room, 1, undefined);
  }

  private async uniqueRoomCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateRoomCode();
      const existing = await this.prisma.watchRoom.findUnique({ where: { roomCode: code } });
      if (!existing) return code;
    }
    throw new ConflictException({ message: 'Could not generate a room code', details: { reason: 'CODE_COLLISION' } });
  }

  async join(userId: string, roomId: string, deviceKey?: string): Promise<WatchRoomResponseDto> {
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    return this.admit(userId, room, deviceKey);
  }

  /** Edge 4.1 — join by the code on the invite; wrong guesses are counted and locked out. */
  async joinByCode(userId: string, rawCode: string, deviceKey?: string): Promise<WatchRoomResponseDto> {
    this.codeGuesses.assertNotLocked(userId);
    const code = normalizeRoomCode(rawCode);
    const room = await this.prisma.watchRoom.findUnique({
      where: { roomCode: code },
      include: { participants: { include: { participant: { select: { fullName: true } } } } },
    });
    if (!room) {
      this.codeGuesses.recordFailure(userId);
      throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    }
    this.codeGuesses.recordSuccess(userId);
    return this.admit(userId, room, deviceKey);
  }

  /** The door of the room: status, expiry, then every gate of RoomJoinGuard (edges 1.1–7.3). */
  private async admit(userId: string, room: RoomWithParticipants, deviceKey?: string): Promise<WatchRoomResponseDto> {
    assertOpen(room);
    if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
      await this.close(room.id);
      throw new ConflictException({ message: 'Room has expired', details: { reason: 'ROOM_EXPIRED' } });
    }
    await this.guard.assertMayJoin(userId, room.episodeId, room, deviceKey);

    const already = room.participants.find((p) => p.userId === userId);
    if (already) {
      if (already.leftAt) {
        await this.prisma.roomParticipant.update({ where: { id: already.id }, data: { leftAt: null } });
      }
    } else {
      await this.prisma.roomParticipant.create({ data: { roomId: room.id, userId, role: 'PARTICIPANT' } });
    }
    const updated = await this.findRoom(room.id);
    return roomSnapshot(updated!);
  }

  async detail(userId: string, roomId: string): Promise<WatchRoomResponseDto> {
    await this.assertCanUse(userId);
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const inRoom = room.participants.some((p) => p.userId === userId);
    if (!inRoom) throw new ForbiddenException({ message: 'Not a participant', details: { reason: 'NOT_PARTICIPANT' } });
    return roomSnapshot(room);
  }

  async hostSync(
    userId: string,
    roomId: string,
    dto: { state: 'PLAYING' | 'PAUSED' | 'ENDED'; positionSeconds: number },
  ): Promise<WatchRoomResponseDto> {
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const host = room.participants.find((p) => p.userId === userId && p.role === 'HOST' && !p.leftAt);
    if (!host) throw new ForbiddenException({ message: 'Only the Host may sync', details: { reason: 'NOT_HOST' } });
    // A disbanded room never comes back to life through a late sync.
    assertNotDisbanded(room);
    await this.assertCanUse(userId);

    // BR-69: the 15 minutes count from the last sign of the Host (play, pause, seek or the end of the episode),
    // so a room in use never expires mid-episode; it closes 15 min after the episode ends or the Host goes quiet.
    const expiresAt = new Date(Date.now() + ROOM_TTL_MS);
    const updated = await this.prisma.watchRoom.update({
      where: { id: roomId },
      // The Host clock may carry fractions of a second; the column keeps whole seconds.
      data: {
        status: dto.state,
        currentPositionSeconds: Math.floor(dto.positionSeconds),
        lastHostPingAt: new Date(),
        expiresAt,
      },
      include: { participants: { include: { participant: { select: { fullName: true } } } } },
    });
    return roomSnapshot(updated);
  }

  /**
   * Edge 3.2 — a leaving Host chooses: hand the room to a friend (TRANSFER) or close it for
   * everyone (DISBAND). Without a choice the earliest member is promoted; an empty room closes.
   */
  async leave(
    userId: string,
    roomId: string,
    opts: { action?: 'TRANSFER' | 'DISBAND'; newHostUserId?: string } = {},
  ): Promise<{ closed: boolean; newHostUserId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.watchRoom.findUnique({
        where: { id: roomId },
        include: { participants: { include: { participant: { select: { fullName: true } } } } },
      });
      if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
      const me = room.participants.find((p) => p.userId === userId);
      if (!me || me.leftAt || room.status === 'DISBANDED') {
        return { closed: room.status === 'DISBANDED', newHostUserId: null };
      }

      if (me.role !== 'HOST') {
        await tx.roomParticipant.updateMany({
          where: { id: me.id, leftAt: null },
          data: { leftAt: new Date() },
        });
        return { closed: false, newHostUserId: null };
      }

      const candidates = room.participants
        .filter((p) => p.userId !== userId && !p.leftAt && p.role !== 'HOST')
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
      const requestedHost = opts.action === 'DISBAND' ? undefined : opts.newHostUserId;
      if (requestedHost && !candidates.some((p) => p.userId === requestedHost)) {
        throw new BadRequestException({
          message: 'The new Host must be a member still in the room',
          details: { reason: 'NEW_HOST_NOT_IN_ROOM' },
        });
      }
      if (opts.action === 'TRANSFER' && !requestedHost && candidates.length) {
        throw new BadRequestException({
          message: 'Choose a member in the room to become the new Host',
          details: { reason: 'NEW_HOST_REQUIRED' },
        });
      }

      const next = requestedHost ? candidates.find((p) => p.userId === requestedHost) : candidates[0];
      const now = new Date();
      const left = await tx.roomParticipant.updateMany({
        where: { id: me.id, role: 'HOST', leftAt: null },
        data: { leftAt: now, role: 'PARTICIPANT' },
      });
      if (left.count !== 1) {
        throw new ConflictException({ message: 'The Host changed while leaving', details: { reason: 'HOST_CHANGED' } });
      }

      if (opts.action === 'DISBAND' || !next) {
        const closed = await tx.watchRoom.updateMany({
          where: { id: roomId, hostUserId: userId, status: { not: 'DISBANDED' } },
          data: { status: 'DISBANDED', expiresAt: now },
        });
        if (closed.count !== 1) {
          throw new ConflictException({
            message: 'The room changed while leaving',
            details: { reason: 'ROOM_CHANGED' },
          });
        }
        return { closed: true, newHostUserId: null };
      }

      const promoted = await tx.roomParticipant.updateMany({
        where: { id: next.id, roomId, role: 'PARTICIPANT', leftAt: null },
        data: { role: 'HOST' },
      });
      if (promoted.count !== 1) {
        throw new ConflictException({
          message: 'The selected member is no longer in the room',
          details: { reason: 'NEW_HOST_NOT_IN_ROOM' },
        });
      }
      const transferred = await tx.watchRoom.updateMany({
        where: { id: roomId, hostUserId: userId, status: { not: 'DISBANDED' } },
        data: { hostUserId: next.userId },
      });
      if (transferred.count !== 1) {
        throw new ConflictException({ message: 'The room changed while leaving', details: { reason: 'ROOM_CHANGED' } });
      }
      return { closed: false, newHostUserId: next.userId };
    });
  }

  /**
   * Edges 3.1 and 3.3 — the Host seat moves on: to the named member, else to the earliest active
   * one. Answers the new Host's id, or null when nobody is left to take the seat.
   */
  async promoteNextHost(roomId: string, preferredUserId?: string): Promise<string | null> {
    const room = await this.findRoom(roomId);
    if (!room || room.status === 'DISBANDED') return null;
    const candidates = room.participants
      .filter((p) => !p.leftAt && p.role !== 'HOST')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
    const next = preferredUserId ? candidates.find((p) => p.userId === preferredUserId) : candidates[0];
    if (!next) return null;

    await this.prisma.$transaction([
      this.prisma.roomParticipant.updateMany({ where: { roomId, role: 'HOST' }, data: { role: 'PARTICIPANT' } }),
      this.prisma.roomParticipant.update({ where: { id: next.id }, data: { role: 'HOST' } }),
      this.prisma.watchRoom.update({ where: { id: roomId }, data: { hostUserId: next.userId } }),
    ]);
    return next.userId;
  }

  /**
   * Edge 3.5 and 1.2 — the Host moves the room to the next episode. Every member is re-checked
   * against the new episode first: those without a right to it are let go with the paywall info.
   */
  async nextEpisode(userId: string, roomId: string): Promise<{ room: WatchRoomResponseDto; blockedUserIds: string[] }> {
    return advanceRoomEpisode(this.prisma, this.entitlement, userId, roomId, () => this.assertCanUse(userId));
  }

  /** Edge 1.4 — the episode was taken down: every open room on it closes at once. */
  async terminateByEpisode(episodeId: string): Promise<string[]> {
    const rooms = await this.prisma.watchRoom.findMany({
      where: { episodeId, status: { not: 'DISBANDED' } },
      select: { id: true },
    });
    if (!rooms.length) return [];
    await this.prisma.watchRoom.updateMany({
      where: { id: { in: rooms.map((r) => r.id) } },
      data: { status: 'DISBANDED', expiresAt: new Date() },
    });
    return rooms.map((r) => r.id);
  }

  /** Close the room and mark it DISBANDED. */
  async close(roomId: string): Promise<void> {
    await this.prisma.watchRoom.update({
      where: { id: roomId },
      data: { status: 'DISBANDED', expiresAt: new Date() },
    });
  }

  private findRoom(roomId: string) {
    return this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: { include: { participant: { select: { fullName: true } } } } },
    });
  }
}
