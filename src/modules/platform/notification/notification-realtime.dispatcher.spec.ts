import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationRealtimeDispatcher } from './notification-realtime.dispatcher';
import type { NotificationRealtimeGateway } from './notification-realtime.gateway';

describe('NotificationRealtimeDispatcher', () => {
  const prisma = {
    notificationRealtimeEvent: { findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const gateway = { publishChanged: jest.fn() };
  const dispatcher = new NotificationRealtimeDispatcher(
    prisma as unknown as PrismaService,
    gateway as unknown as NotificationRealtimeGateway,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits committed recipient invalidations, then removes the outbox rows', async () => {
    prisma.notificationRealtimeEvent.findMany.mockResolvedValue([
      { id: 'e1', userId: 'u1' },
      { id: 'e2', userId: 'u2' },
    ]);
    gateway.publishChanged.mockReturnValue(true);

    await dispatcher.dispatchPending();

    expect(gateway.publishChanged.mock.calls).toEqual([['u1'], ['u2']]);
    expect(prisma.notificationRealtimeEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['e1', 'e2'] } } });
  });

  it('keeps events pending when the socket namespace is not ready', async () => {
    prisma.notificationRealtimeEvent.findMany.mockResolvedValue([{ id: 'e1', userId: 'u1' }]);
    gateway.publishChanged.mockReturnValue(false);

    await dispatcher.dispatchPending();

    expect(prisma.notificationRealtimeEvent.deleteMany).not.toHaveBeenCalled();
  });
});
