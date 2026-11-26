import { isUUID } from 'class-validator';
import { MAX_POSITION_SECONDS } from 'src/modules/playback/watch-progress/dto/position-limit';

/**
 * Socket payloads skip the HTTP ValidationPipe, so every room event checks its own body here. A bad body is
 * answered `ROOM_ERROR { reason: 'INVALID_PAYLOAD' }` before it reaches Prisma (a malformed id would otherwise
 * surface as a raw database error) or the live clock (a NaN position would be broadcast to the whole room).
 */
export const INVALID_PAYLOAD = { reason: 'INVALID_PAYLOAD' } as const;

const PLAYBACK_STATES = ['PLAYING', 'PAUSED', 'ENDED'] as const;
export type RoomPlaybackState = (typeof PLAYBACK_STATES)[number];

function record(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value, 4);
}

/** `{ roomId }` of JOIN, LEAVE, VOTE_HOST and the shared-screen events. */
export function roomIdOf(body: unknown): string | null {
  const roomId = record(body)?.roomId;
  return uuid(roomId) ? roomId : null;
}

/** `{ roomId, state, positionSeconds }` of the Host's PLAYBACK event; a fraction of a second is kept. */
export function playbackOf(
  body: unknown,
): { roomId: string; state: RoomPlaybackState; positionSeconds: number } | null {
  const roomId = roomIdOf(body);
  const { state, positionSeconds } = record(body) ?? {};
  if (!roomId || !PLAYBACK_STATES.includes(state as RoomPlaybackState)) return null;
  if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return null;
  if (positionSeconds < 0 || positionSeconds > MAX_POSITION_SECONDS) return null;
  return { roomId, state: state as RoomPlaybackState, positionSeconds };
}

/** `{ roomId, friendId }` of INVITE; inviting oneself is not an invite. */
export function inviteOf(body: unknown, userId: string): { roomId: string; friendId: string } | null {
  const roomId = roomIdOf(body);
  const friendId = record(body)?.friendId;
  if (!roomId || !uuid(friendId) || friendId === userId) return null;
  return { roomId, friendId };
}

/** An optional ad break id of AD_BREAK: absent, or a UUID. */
export function optionalUuid(value: unknown): value is string | undefined {
  return value === undefined || uuid(value);
}
