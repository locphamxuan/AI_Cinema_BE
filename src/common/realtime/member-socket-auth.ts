import type { JwtService } from '@nestjs/jwt';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';

type HandshakeSocket = {
  handshake: { auth: unknown; headers: { authorization?: string } };
  data: { userId?: string };
};

/** The access JWT a client sends on connect: `auth.token`, else an `Authorization: Bearer` header. */
export function handshakeTokenOf(client: {
  handshake: { auth: unknown; headers: { authorization?: string } };
}): string {
  const auth = client.handshake.auth as { token?: string } | undefined;
  const header = client.handshake.headers.authorization;
  return auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : '');
}

/** A token outlives a lock-out: a socket checks the account like the HTTP guard does. */
export async function assertActiveAccount(
  prisma: { user: { findUnique(args: object): Promise<{ isActive: boolean; role: string } | null> } },
  userId: string,
): Promise<void> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
  if (!account?.isActive) throw new Error('account deactivated');
  if (account.role !== 'MEMBER') throw new Error('members only');
}

/** The member of a handshake token: a valid access token of an active Member account, else it throws. */
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

/**
 * Socket.io middleware admits a socket only after its token and active Member account are checked.
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
