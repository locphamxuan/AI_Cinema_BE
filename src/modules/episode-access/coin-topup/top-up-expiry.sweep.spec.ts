import { PaymentStatus, TopUpStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { TopUpExpirySweep } from './top-up-expiry.sweep';

describe('TopUpExpirySweep', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  const prisma = {
    coinTopUp: { findMany: jest.fn(), updateManyAndReturn: jest.fn() },
    payment: { updateMany: jest.fn() },
  };
  const queue = { every: jest.fn() };
  const notifications = { notify: jest.fn() };
  const config = { schedules: { coinTopUpSweepMs: 60_000 } };
  const build = (withNotifications = true) =>
    new TopUpExpirySweep(
      prisma as unknown as PrismaService,
      queue as unknown as JobQueue,
      config as unknown as AppConfig,
      withNotifications ? (notifications as unknown as NotificationService) : undefined,
    );
  const sweep = build();
  const orders = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `topup-${i + offset}`, userId: `user-${i + offset}` }));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coinTopUp.updateManyAndReturn.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(where.id.in.map((id) => ({ id, userId: id.replace('topup', 'user') }))),
    );
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
  });

  it('registers the recurring job on the configured schedule', async () => {
    queue.every.mockResolvedValue(undefined);
    await (sweep.onModuleInit() as unknown as Promise<void>);
    expect(queue.every).toHaveBeenCalledWith('coin-topup-expire.sweep', 60_000, expect.any(Function));

    prisma.coinTopUp.findMany.mockResolvedValue([]);
    const handler = (queue.every.mock.calls as unknown[][])[0][2] as () => Promise<unknown>;
    await expect(handler()).resolves.toBeUndefined();
  });

  it('closes nothing when no PENDING order is past its expiry', async () => {
    prisma.coinTopUp.findMany.mockResolvedValue([]);

    await expect(sweep.expireDue(now)).resolves.toBe(0);
    expect(prisma.coinTopUp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: TopUpStatus.PENDING, expiresAt: { lte: now } }, take: 100 }),
    );
    expect(prisma.coinTopUp.updateManyAndReturn).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('expires stale orders and their pending payments, guarded on PENDING, and tells each member', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(2));

    await expect(sweep.expireDue(now)).resolves.toBe(2);

    expect(prisma.coinTopUp.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: { in: ['topup-0', 'topup-1'] }, status: TopUpStatus.PENDING },
      data: { status: TopUpStatus.EXPIRED, failureReason: expect.any(String) },
      select: { id: true, userId: true },
    });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { coinTopUpId: { in: ['topup-0', 'topup-1'] }, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.EXPIRED, failureReason: expect.any(String) },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.COIN_TOPUP_FAILED, payload: { topUpId: 'topup-1' } }),
    );
  });

  it('closes, counts and tells only the orders this run claimed, not those a parallel sweep took', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(3));
    prisma.coinTopUp.updateManyAndReturn.mockResolvedValueOnce([{ id: 'topup-2', userId: 'user-2' }]);

    await expect(sweep.expireDue(now)).resolves.toBe(1);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coinTopUpId: { in: ['topup-2'] }, status: PaymentStatus.PENDING } }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(['user-2'], expect.anything());
  });

  it('leaves payments alone when a parallel sweep claimed the whole batch', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(2));
    prisma.coinTopUp.updateManyAndReturn.mockResolvedValueOnce([]);

    await expect(sweep.expireDue(now)).resolves.toBe(0);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('pages through more than one batch', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(100)).mockResolvedValueOnce(orders(7, 100));

    await expect(sweep.expireDue(now)).resolves.toBe(107);
    expect(prisma.coinTopUp.findMany).toHaveBeenCalledTimes(2);
  });

  it('works without a notification service', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(1));

    await expect(build(false).expireDue(now)).resolves.toBe(1);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('propagates a database failure', async () => {
    prisma.coinTopUp.findMany.mockResolvedValueOnce(orders(1));
    prisma.coinTopUp.updateManyAndReturn.mockRejectedValueOnce(new Error('db down'));

    await expect(sweep.expireDue(now)).rejects.toThrow('db down');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
