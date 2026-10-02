import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NOTIFICATION_TYPE } from './notification-types';

describe('NotificationService', () => {
  const prisma = {
    notification: { createMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const service = new NotificationService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('notifies every distinct recipient once and skips empty ids', async () => {
    await service.notify(['a', null, 'b', 'a', undefined], {
      type: NOTIFICATION_TYPE.MEDIA_FAILED,
      title: 'Episode 2 failed',
    });

    const [{ data }] = prisma.notification.createMany.mock.calls[0] as [{ data: { userId: string }[] }];
    expect(data.map((row) => row.userId)).toEqual(['a', 'b']);
  });

  it('writes nothing without a recipient', async () => {
    await service.notify([null], { type: NOTIFICATION_TYPE.MEDIA_READY, title: 'x' });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('writes inside the given transaction', async () => {
    const tx = { notification: { createMany: jest.fn() } };
    await service.notify(['a'], { type: NOTIFICATION_TYPE.MEDIA_READY, title: 'x' }, tx as never);
    expect(tx.notification.createMany).toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('marks only the caller notification as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.markRead('user-1', 'n1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1', userId: 'user-1', readAt: null } }),
    );
  });

  it('answers 404 for a notification of someone else', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.count.mockResolvedValue(0);
    await expect(service.markRead('user-1', 'n2')).rejects.toThrow(NotFoundException);
  });

  it('lists the active admins', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    await expect(service.adminIds()).resolves.toEqual(['admin-1']);
  });
});
