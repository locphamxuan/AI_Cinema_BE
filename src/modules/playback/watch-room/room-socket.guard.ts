import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ROOM_EVENT } from './room-events';

/**
 * Room events only from a socket whose handshake token was already checked. handleConnection verifies
 * the JWT asynchronously while socket.io already delivers events, so without this an event sent right
 * after connecting would run with no member id (and Prisma drops an undefined filter).
 */
export class SignedInSocketGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context
      .switchToWs()
      .getClient<{ data: { userId?: string }; emit(event: string, body: object): void }>();
    if (client.data?.userId) return true;
    client.emit(ROOM_EVENT.ERROR, { reason: 'UNAUTHENTICATED' });
    return false;
  }
}
