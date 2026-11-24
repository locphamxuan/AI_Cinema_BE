import type { JwtService } from '@nestjs/jwt';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
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
  // Anything else (a database or network fault) stays on the server: its text is no business of the client.
  return { reason: 'ROOM_ERROR' };
}

/** The access JWT a client sends on connect: `auth.token`, else an `Authorization: Bearer` header. */
export function handshakeTokenOf(client: {
  handshake: { auth: unknown; headers: { authorization?: string } };
}): string {
  const auth = client.handshake.auth as { token?: string } | undefined;
  const header = client.handshake.headers.authorization;
  return auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : '');
}

/** A token outlives a lock-out: a socket checks the account like the HTTP guard does (audit 2026-11-12). */
export async function assertActiveAccount(
  prisma: { user: { findUnique(args: object): Promise<{ isActive: boolean; role: string } | null> } },
  userId: string,
): Promise<void> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
  if (!account?.isActive) throw new Error('account deactivated');
  // 2026-11-13: watch rooms are a Member feature only.
  if (account.role !== 'MEMBER') throw new Error('members only');
}

/** The member of a handshake token: a valid access token of an active Member account (BR-69), else it throws. */
export async function memberOfToken(
  jwt: Pick<JwtService, 'verifyAsync'>,
  options: { issuer: string; audience: string },
  prisma: Parameters<typeof assertActiveAccount>[0],
  token: string,
): Promise<string> {
  const payload = await jwt.verifyAsync<AccessTokenPayload>(token, {
    algorithms: [JWT_ALGORITHM],
    issuer: options.issuer,
    audience: options.audience,
  });
  if (payload.type !== 'access') throw new Error('not an access token');
  await assertActiveAccount(prisma, payload.sub);
  return payload.sub;
}

type HandshakeSocket = Parameters<typeof handshakeTokenOf>[0] & { data: { userId?: string } };

/**
 * Socket.io middleware of the /watch namespace: a socket connects only once its token and account are checked, so
 * the client's `connect` (and the JOIN it sends at once) never reaches a gateway that does not know the member yet.
 * A refused handshake reaches the client as `connect_error` with the message `UNAUTHENTICATED`.
 */
export function socketAuth(userOf: (token: string) => Promise<string>) {
  return (socket: HandshakeSocket, next: (error?: Error) => void): void => {
    userOf(handshakeTokenOf(socket)).then(
      (userId) => {
        socket.data.userId = userId;
        next();
      },
      () => next(Object.assign(new Error('UNAUTHENTICATED'), { data: { reason: 'UNAUTHENTICATED' } })),
    );
  };
}
