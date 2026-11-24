import { ConflictException } from '@nestjs/common';
import { WatchRoomStatus } from '@prisma/client';
import { WatchRoomResponseDto, type ParticipantDto } from './dto/watch-room.dto';

/** The room closes 15 min after the episode ends or the Host leaves (BR-69); every Host sync extends it. */
export const ROOM_TTL_MS = 15 * 60 * 1000;

export const OPEN_STATUSES: WatchRoomStatus[] = [
  WatchRoomStatus.CREATED,
  WatchRoomStatus.WAITING_FOR_PARTICIPANTS,
  WatchRoomStatus.PLAYING,
  WatchRoomStatus.PAUSED,
];

/** A room the Host can still drive; a closed one answers 409 ROOM_CLOSED. */
export function assertOpen(room: { status: WatchRoomStatus }): void {
  if (OPEN_STATUSES.includes(room.status)) return;
  throw new ConflictException({ message: 'Room is closed', details: { reason: 'ROOM_CLOSED' } });
}

/** A room as the service reads it: the row with its participants and their names. */
export interface RoomRow {
  id: string;
  roomCode: string;
  episodeId: string;
  hostUserId: string | null;
  status: WatchRoomStatus;
  currentPositionSeconds: number;
  lastHostPingAt: Date | null;
  participants: { userId: string; leftAt: Date | null; participant?: { fullName: string } | null }[];
}

/** Flatten the active participants of a room into { userId, fullName }. */
function activeParticipants(room: RoomRow): ParticipantDto[] {
  return room.participants
    .filter((p) => !p.leftAt)
    .map((p) => ({ userId: p.userId, fullName: p.participant?.fullName ?? 'Thành viên' }));
}

/**
 * Edge 2.1 — the late joiner's snapshot: the position is extrapolated from the Host's last ping
 * while the room plays, and the server clock rides along so the client can offset the transit.
 */
export function roomSnapshot(room: RoomRow): WatchRoomResponseDto {
  const participants = activeParticipants(room);
  const dto = WatchRoomResponseDto.from(room, participants.length, participants);
  dto.serverTimestamp = Date.now();
  if (room.status === WatchRoomStatus.PLAYING && room.lastHostPingAt) {
    dto.currentPositionSeconds =
      room.currentPositionSeconds + Math.max(0, (Date.now() - room.lastHostPingAt.getTime()) / 1000);
  }
  return dto;
}
