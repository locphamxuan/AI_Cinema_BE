import { ForbiddenException } from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';

/** Who is calling a session-owned route: the member, the guest key, or nobody. */
export interface SessionCaller {
  userId?: string;
  guestKey?: string;
}

/** The one answer for a row that is no longer ACTIVE, whichever path notices it. */
export function sessionNotActive(): never {
  throw new ForbiddenException({
    message: 'The streaming session is no longer active',
    details: { reason: 'SESSION_NOT_ACTIVE' },
  });
}

/**
 * A session-owned route (heartbeat, stop, complete, ad breaks) may only touch a live session of
 * its caller: the member it was opened for, or the guest key it was opened with.
 */
export function assertLiveSessionOf(
  session: { userId: string | null; guestKey: string | null; status: StreamingSessionStatus },
  caller: SessionCaller,
): void {
  const mine = session.userId
    ? Boolean(caller.userId) && session.userId === caller.userId
    : Boolean(caller.guestKey) && session.guestKey === caller.guestKey;
  if (!mine) {
    throw new ForbiddenException({
      message: 'This session belongs to someone else',
      details: { reason: 'SESSION_NOT_OWNER' },
    });
  }
  if (session.status !== StreamingSessionStatus.ACTIVE) sessionNotActive();
}
