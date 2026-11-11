import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchRoomResponseDto } from './dto/watch-room.dto';

/** The room closes 15 min after the episode ends or the Host leaves (BR-69). */
const ROOM_TTL_MS = 15 * 60 * 1000;

/** 6–8 base32 characters, shown to members who join by code. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
    .slice(0, 7)
    .join('');
}

@Injectable()
export class WatchRoomService {
  private readonly logger = new Logger(WatchRoomService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: { episodeId: string }): Promise<WatchRoomResponseDto> {
    const episode = await this.prisma.episode.findUnique({ where: { id: dto.episodeId } });
    if (!episode)
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });

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
    await this.prisma.roomParticipant.create({
      data: { roomId: room.id, userId, role: 'HOST' },
    });
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
    const room = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    if (room.status === 'ENDED' || room.status === 'DISBANDED') {
      throw new ConflictException({ message: 'Room is closed', details: { reason: 'ROOM_CLOSED' } });
    }
    if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
      await this.close(room.id);
      throw new ConflictException({ message: 'Room has expired', details: { reason: 'ROOM_EXPIRED' } });
    }

    const already = room.participants.find((p) => p.userId === userId);
    if (already) {
      if (already.leftAt) {
        await this.prisma.roomParticipant.update({ where: { id: already.id }, data: { leftAt: null } });
      }
    } else {
      await this.prisma.roomParticipant.create({ data: { roomId, userId, role: 'PARTICIPANT' } });
    }
    const updated = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    return WatchRoomResponseDto.from(updated!, updated!.participants.length);
  }

  async detail(userId: string, roomId: string): Promise<WatchRoomResponseDto> {
    const room = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const inRoom = room.participants.some((p) => p.userId === userId);
    if (!inRoom) throw new ForbiddenException({ message: 'Not a participant', details: { reason: 'NOT_PARTICIPANT' } });
    return WatchRoomResponseDto.from(room, room.participants.length);
  }

  async hostSync(
    userId: string,
    roomId: string,
    dto: { state: 'PLAYING' | 'PAUSED' | 'ENDED'; positionSeconds: number },
  ): Promise<WatchRoomResponseDto> {
    const room = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const host = room.participants.find((p) => p.userId === userId && p.role === 'HOST');
    if (!host) throw new ForbiddenException({ message: 'Only the Host may sync', details: { reason: 'NOT_HOST' } });

    const status = dto.state === 'ENDED' ? 'ENDED' : dto.state;
    const expiresAt = dto.state === 'ENDED' ? new Date(Date.now() + ROOM_TTL_MS) : room.expiresAt;
    const updated = await this.prisma.watchRoom.update({
      where: { id: roomId },
      data: { status, currentPositionSeconds: dto.positionSeconds, lastHostPingAt: new Date(), expiresAt },
      include: { participants: true },
    });
    return WatchRoomResponseDto.from(updated, updated.participants.length);
  }

  async leave(userId: string, roomId: string): Promise<void> {
    const room = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    const me = room.participants.find((p) => p.userId === userId);
    if (me) {
      await this.prisma.roomParticipant.update({ where: { id: me.id }, data: { leftAt: new Date() } });
    }
    const hostLeft = me?.role === 'HOST';
    const remainingHosts = room.participants.filter((p) => p.role === 'HOST' && p.userId !== userId && !p.leftAt);
    if (hostLeft && remainingHosts.length === 0) {
      await this.close(room.id);
    }
  }

  /** Close the room and mark it DISBANDED. */
  async close(roomId: string): Promise<void> {
    await this.prisma.watchRoom.update({
      where: { id: roomId },
      data: { status: 'DISBANDED', expiresAt: new Date() },
    });
  }
}
