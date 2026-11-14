import type { ExecutionContext } from '@nestjs/common';
import { ROOM_EVENT } from './room-events';
import { SignedInSocketGuard } from './room-socket.guard';

const contextOf = (data: { userId?: string }) => {
  const client = { data, emit: jest.fn() };
  const context = { switchToWs: () => ({ getClient: () => client }) } as unknown as ExecutionContext;
  return { client, context };
};

describe('SignedInSocketGuard', () => {
  const guard = new SignedInSocketGuard();

  it('lets a socket whose token was verified send room events', () => {
    const { client, context } = contextOf({ userId: 'member-1' });
    expect(guard.canActivate(context)).toBe(true);
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('drops an event sent before the handshake check finished, telling the client why', () => {
    const { client, context } = contextOf({});
    expect(guard.canActivate(context)).toBe(false);
    expect(client.emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'UNAUTHENTICATED' });
  });
});
