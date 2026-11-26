import type { Server } from 'socket.io';
import type { LivePlaybackState } from './room-live-state';
import { ROOM_CHANNEL, ROOM_EVENT, ROOM_TERMINATED_REASON } from './room-events';
import type { RoomCluster } from './room-cluster';

export {
  assertActiveAccount,
  handshakeTokenOf,
  memberOfToken,
  socketAuth,
} from 'src/common/realtime/member-socket-auth';

/** The playback state a stored room status starts the live clock in. */
export function liveStateOf(status: string): LivePlaybackState {
  if (status === 'PLAYING') return 'PLAYING';
  if (status === 'ENDED') return 'ENDED';
  return 'PAUSED';
}

/**
 * An HTTP exception thrown by the room service, as a socket ROOM_ERROR payload: the message plus
 * the `details.reason` the clients map to their bottom sheets (ROOM_FULL, AGE_RESTRICTED, …).
 */
export function socketErrorOf(e: unknown): { reason: string; details?: unknown } {
  const response = (e as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object') {
    const { message, details } = response as { message?: string; details?: unknown };
    return { reason: message ?? 'ROOM_ERROR', details };
  }
  // Anything else (a database or network fault) stays on the server: its text is no business of the client.
  return { reason: 'ROOM_ERROR' };
}

export async function detachRoomMember(
  server: Server,
  cluster: RoomCluster,
  roomId: string,
  userId: string,
): Promise<void> {
  const sockets = await server.in(ROOM_CHANNEL(roomId)).fetchSockets();
  for (const socket of sockets) {
    if ((socket.data as { userId?: string }).userId !== userId) continue;
    socket.leave(ROOM_CHANNEL(roomId));
    (socket.data as { roomId?: string }).roomId = undefined;
  }
  cluster.seats.release(roomId, userId);
  cluster.publish({ t: 'unseat', roomId, userId, keepSocketId: '' });
}

export async function notifyWhenRoomAlone(server: Server, roomId: string): Promise<void> {
  const sockets = await server.in(ROOM_CHANNEL(roomId)).fetchSockets();
  if (sockets.length === 1) {
    sockets[0].emit(ROOM_EVENT.LAST_ONE_LEFT, {
      message: 'Everyone else left the room; switch back to watching alone?',
    });
  }
}

export function broadcastRoomTermination(
  server: Server,
  cluster: RoomCluster,
  roomIds: string[],
  reason: string,
): void {
  for (const roomId of roomIds) {
    server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.TERMINATED, { roomId, reason });
    cluster.forget(roomId);
    cluster.publish({ t: 'drop', roomId });
  }
}

export function handOverRoom(cluster: RoomCluster, roomId: string, hostUserId: string | null): void {
  cluster.live.setHost(roomId, hostUserId);
  cluster.publish({ t: 'host', roomId, hostUserId });
}

export async function handleHostGraceExpired(
  server: Server,
  cluster: RoomCluster,
  rooms: { promoteNextHost(roomId: string): Promise<string | null>; close(roomId: string): Promise<void> },
  roomId: string,
  hostUserId: string,
): Promise<void> {
  if (await cluster.isSeated(roomId, hostUserId)) return;
  const newHost = await rooms.promoteNextHost(roomId);
  if (newHost) {
    handOverRoom(cluster, roomId, newHost);
    server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HOST_CHANGED, { newHostUserId: newHost, reason: 'HOST_TIMEOUT' });
    return;
  }
  await rooms.close(roomId);
  broadcastRoomTermination(server, cluster, [roomId], ROOM_TERMINATED_REASON.HOST_LEFT);
}
