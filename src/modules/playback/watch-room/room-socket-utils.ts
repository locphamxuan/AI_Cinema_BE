import type { LivePlaybackState } from './room-live-state';

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
  return { reason: (e as Error).message };
}

/** The access JWT a client sends on connect: `auth.token`, else an `Authorization: Bearer` header. */
export function handshakeTokenOf(client: {
  handshake: { auth: unknown; headers: { authorization?: string } };
}): string {
  const auth = client.handshake.auth as { token?: string } | undefined;
  const header = client.handshake.headers.authorization;
  return auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : '');
}
