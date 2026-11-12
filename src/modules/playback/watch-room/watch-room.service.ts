import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WatchRoomStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import { VISIBLE_EPISODE } from 'src/modules/catalog/episode-visibility';
import { CodeGuessLimiter, generateRoomCode, normalizeRoomCode } from './room-codes';
import { RoomJoinGuard } from './room-join.guard';
import { WatchRoomResponseDto } from './dto/watch-room.dto';

/** The room closes 15 min after the episode ends or the Host leaves (BR-69). */
const ROOM_TTL_MS = 15 * 60 * 1000;

const OPEN_STATUSES: WatchRoomStatus[] = [
  WatchRoomStatus.CREATED,
  WatchRoomStatus.WAITING_FOR_PARTICIPANTS,
  WatchRoomStatus.PLAYING,
  WatchRoomStatus.PAUSED,
];

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

  /** The Host, too, passes the paywall gate: a room never starts on an episode its Host cannot watch. */
  async create(userId: string, dto: { episodeId: string }): Promise<WatchRoomResponseDto> {
    const episode = await this.prisma.episode.findUnique({ where: { id: dto.episodeId } });
    if (!episode)
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    await this.guard.assertMayJoin(userId, dto.episodeId);

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
    return WatchRoomResponseDto.from(room, 1);
  }

  private async uniqueRoomCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateRoomCode();
      const existing = await this.prisma.watchRoom.findUnique({ where: { roomCode: code } });
      if (!existing) return code;
    }
    throw new ConflictException({ message: 'Could not generate a room code', details: { reason: 'CODE_COLLISION' } });
  }

  async join(userId: string, roomId: string): Promise<WatchRoomResponseDto> {
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    return this.admit(userId, room);
  }

  /** Edge 4.1 — join by the code on the invite; wrong guesses are counted and locked out. */
  async joinByCode(userId: string, rawCode: string): Promise<WatchRoomResponseDto> {
    this.codeGuesses.assertNotLocked(userId);
    const code = normalizeRoomCode(rawCode);
    const room = await this.prisma.watchRoom.findUnique({ where: { roomCode: code }, include: { participants: true } });
    if (!room) {
      this.codeGuesses.recordFailure(userId);
      throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    }
    this.codeGuesses.recordSuccess(userId);
    return this.admit(userId, room);
  }

  /** The door of the room: status, expiry, then every gate of RoomJoinGuard (edges 1.1–7.3). */
  private async admit(userId: string, room: RoomWithParticipants): Promise<WatchRoomResponseDto> {
    if (!OPEN_STATUSES.includes(room.status)) {
      throw new ConflictException({ message: 'Room is closed', details: { reason: 'ROOM_CLOSED' } });
    }
    if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
      await this.close(room.id);
      throw new ConflictException({ message: 'Room has expired', details: { reason: 'ROOM_EXPIRED' } });
    }
    await this.guard.assertMayJoin(userId, room.episodeId, room);

    const already = room.participants.find((p) => p.userId === userId);
    if (already) {
      if (already.leftAt) {
        await this.prisma.roomParticipant.update({ where: { id: already.id }, data: { leftAt: null } });
      }
    } else {
      await this.prisma.roomParticipant.create({ data: { roomId: room.id, userId, role: 'PARTICIPANT' } });
    }
    const updated = await this.findRoom(room.id);
    return this.snapshot(updated!);
  }

  async detail(userId: string, roomId: string): Promise<WatchRoomResponseDto> {
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const inRoom = room.participants.some((p) => p.userId === userId);
    if (!inRoom) throw new ForbiddenException({ message: 'Not a participant', details: { reason: 'NOT_PARTICIPANT' } });
    return this.snapshot(room);
  }

  async hostSync(
    userId: string,
    roomId: string,
    dto: { state: 'PLAYING' | 'PAUSED' | 'ENDED'; positionSeconds: number },
  ): Promise<WatchRoomResponseDto> {
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const host = room.participants.find((p) => p.userId === userId && p.role === 'HOST');
    if (!host) throw new ForbiddenException({ message: 'Only the Host may sync', details: { reason: 'NOT_HOST' } });

    const expiresAt = dto.state === 'ENDED' ? new Date(Date.now() + ROOM_TTL_MS) : room.expiresAt;
    const updated = await this.prisma.watchRoom.update({
      where: { id: roomId },
      data: { status: dto.state, currentPositionSeconds: dto.positionSeconds, lastHostPingAt: new Date(), expiresAt },
      include: { participants: true },
    });
    return this.snapshot(updated);
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
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const me = room.participants.find((p) => p.userId === userId);
    if (me) await this.prisma.roomParticipant.update({ where: { id: me.id }, data: { leftAt: new Date() } });
    if (me?.role !== 'HOST') return { closed: false, newHostUserId: null };

    if (opts.action === 'DISBAND') {
      await this.close(roomId);
      return { closed: true, newHostUserId: null };
    }
    const newHost = await this.promoteNextHost(roomId, opts.newHostUserId);
    if (!newHost) {
      await this.close(roomId);
      return { closed: true, newHostUserId: null };
    }
    return { closed: false, newHostUserId: newHost };
  }

  /**
   * Edges 3.1 and 3.3 — the Host seat moves on: to the named member, else to the earliest active
   * one. Answers the new Host's id, or null when nobody is left to take the seat.
   */
  async promoteNextHost(roomId: string, preferredUserId?: string): Promise<string | null> {
    const room = await this.findRoom(roomId);
    if (!room || !OPEN_STATUSES.includes(room.status)) return null;
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
    const room = await this.findRoom(roomId);
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    if (room.hostUserId !== userId) {
      throw new ForbiddenException({ message: 'Only the Host may continue', details: { reason: 'NOT_HOST' } });
    }
    const current = await this.prisma.episode.findUnique({
      where: { id: room.episodeId },
      select: { movieId: true, episodeNumber: true },
    });
    const next =
      current &&
      (await this.prisma.episode.findFirst({
        where: { movieId: current.movieId, episodeNumber: { gt: current.episodeNumber }, ...VISIBLE_EPISODE },
        orderBy: { episodeNumber: 'asc' },
      }));
    if (!next) {
      throw new NotFoundException({ message: 'No next episode', details: { reason: 'NO_NEXT_EPISODE' } });
    }

    const active = room.participants.filter((p) => !p.leftAt);
    const checks = await Promise.all(
      active.map(async (p) => ({ p, check: await this.entitlement.canWatch(next.id, p.userId) })),
    );
    const blocked = checks.filter(({ p, check }) => !check.allowed && p.userId !== userId);
    await Promise.all(
      blocked.map(({ p }) => this.prisma.roomParticipant.update({ where: { id: p.id }, data: { leftAt: new Date() } })),
    );
    const hostCheck = checks.find(({ p }) => p.userId === userId);
    if (hostCheck && !hostCheck.check.allowed) {
      throw new ForbiddenException({
        message: 'Tập tiếp theo cần mở khóa trước khi phát cho phòng',
        details: { reason: 'ENTITLEMENT_REQUIRED', required: hostCheck.check.required },
      });
    }

    const updated = await this.prisma.watchRoom.update({
      where: { id: roomId },
      data: {
        episodeId: next.id,
        currentPositionSeconds: 0,
        status: 'PAUSED',
        lastHostPingAt: new Date(),
        expiresAt: new Date(Date.now() + ROOM_TTL_MS),
      },
      include: { participants: true },
    });
    return { room: this.snapshot(updated), blockedUserIds: blocked.map(({ p }) => p.userId) };
  }

  /** Edge 1.4 — the episode was taken down: every open room on it closes at once. */
  async terminateByEpisode(episodeId: string): Promise<string[]> {
    const rooms = await this.prisma.watchRoom.findMany({
      where: { episodeId, status: { in: OPEN_STATUSES } },
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
    return this.prisma.watchRoom.findUnique({ where: { id: roomId }, include: { participants: true } });
  }

  /**
   * Edge 2.1 — the late joiner's snapshot: the position is extrapolated from the Host's last ping
   * while the room plays, and the server clock rides along so the client can offset the transit.
   */
  private snapshot(room: RoomWithParticipants): WatchRoomResponseDto {
    const activeCount = room.participants.filter((p) => !p.leftAt).length;
    const dto = WatchRoomResponseDto.from(room, activeCount);
    dto.serverTimestamp = Date.now();
    if (room.status === WatchRoomStatus.PLAYING && room.lastHostPingAt) {
      dto.currentPositionSeconds =
        room.currentPositionSeconds + Math.max(0, (Date.now() - room.lastHostPingAt.getTime()) / 1000);
    }
    return dto;
  }
}
