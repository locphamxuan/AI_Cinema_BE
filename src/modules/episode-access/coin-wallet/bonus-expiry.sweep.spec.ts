import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { BonusExpirySweep } from './bonus-expiry.sweep';
import type { CoinSpendService } from './coin-spend.service';

describe('BonusExpirySweep', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  const tx = { $queryRaw: jest.fn(), coinLot: { updateMany: jest.fn() } };
  const prisma = {
    coinLot: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const coins = { expireBonus: jest.fn() };
  const notifications = { notify: jest.fn() };
  const queue = { every: jest.fn() };
  const config = { schedules: { coinExpirySweepMs: 86_400_000 } };
  const sweep = new BonusExpirySweep(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    notifications as unknown as NotificationService,
    queue as unknown as JobQueue,
    config as unknown as AppConfig,
  );

  const lot = (id: string, remainingAmount: number, userId = 'user-1') => ({
    id,
    walletId: `wallet-${userId}`,
    remainingAmount,
    expiresAt: new Date('2026-11-09T00:00:00.000Z'),
    closedAt: null,
    wallet: { userId, mainBalance: 0, bonusBalance: remainingAmount },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx.coinLot.updateMany.mockResolvedValue({ count: 1 });
  });

  it('registers the recurring job on the configured schedule', async () => {
    queue.every.mockResolvedValue(undefined);
    await (sweep.onModuleInit() as unknown as Promise<void>);
    expect(queue.every).toHaveBeenCalledWith('coin-bonus-expiry.sweep', 86_400_000, expect.any(Function));

    prisma.coinLot.findMany.mockResolvedValue([]);
    const handler = (queue.every.mock.calls as unknown[][])[0][2] as () => Promise<unknown>;
    await expect(handler()).resolves.toBeUndefined();
  });

  it('does nothing when no lot is due', async () => {
    prisma.coinLot.findMany.mockResolvedValue([]);

    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 0, coins: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('only asks for open lots with Coins left whose expiry is at or before now', async () => {
    prisma.coinLot.findMany.mockResolvedValue([]);
    await sweep.expireDue(now);

    expect(prisma.coinLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { lte: now }, id: { notIn: [] } },
        orderBy: { expiresAt: 'asc' },
        take: 200,
      }),
    );
  });

  it('closes each due lot, books BONUS_EXPIRY and tells the owner', async () => {
    prisma.coinLot.findMany.mockResolvedValueOnce([lot('lot-1', 30), lot('lot-2', 20, 'user-2')]);

    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 2, coins: 50 });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.coinLot.updateMany).toHaveBeenCalledWith({
      where: { id: 'lot-1', closedAt: null, remainingAmount: { gt: 0 } },
      data: { remainingAmount: 0, closedAt: now },
    });
    expect(coins.expireBonus).toHaveBeenCalledWith(tx, 'wallet-user-1', {
      id: 'lot-1',
      amount: 30,
      expiresAt: new Date('2026-11-09T00:00:00.000Z'),
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      ['user-2'],
      expect.objectContaining({
        type: NOTIFICATION_TYPE.COIN_BONUS_EXPIRING,
        link: '/wallet',
        payload: expect.objectContaining({ lotId: 'lot-2', amount: 20 }),
      }),
      tx,
    );
  });

  it('keeps paging while a full batch comes back', async () => {
    const full = Array.from({ length: 200 }, (_, i) => lot(`lot-${i}`, 1));
    prisma.coinLot.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([lot('lot-last', 5)]);

    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 201, coins: 205 });
    expect(prisma.coinLot.findMany).toHaveBeenCalledTimes(2);
  });

  it('stops after an exactly-full batch once the next page is empty', async () => {
    const full = Array.from({ length: 200 }, (_, i) => lot(`lot-${i}`, 1));
    prisma.coinLot.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([]);

    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 200, coins: 200 });
    expect(prisma.coinLot.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not book or notify a lot another sweep closed while this one waited for the lock', async () => {
    prisma.coinLot.findMany.mockResolvedValueOnce([lot('lot-1', 30)]);
    tx.coinLot.updateMany.mockResolvedValue({ count: 0 });

    // Nothing closed here, so nothing counted.
    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 0, coins: 0 });

    expect(coins.expireBonus).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('skips a lot that fails (its transaction rolls back) and still closes the lots behind it', async () => {
    const full = [lot('lot-bad', 30), ...Array.from({ length: 199 }, (_, i) => lot(`lot-${i}`, 1))];
    prisma.coinLot.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([lot('lot-last', 5)]);
    coins.expireBonus.mockRejectedValueOnce(new Error('ledger down'));

    await expect(sweep.expireDue(now)).resolves.toEqual({ lots: 200, coins: 204 });
    // The failed lot is left out of the next page, so it cannot block the queue; the next run retries it.
    const second = (prisma.coinLot.findMany.mock.calls as [{ where: { id: { notIn: string[] } } }][])[1][0];
    expect(second.where.id.notIn).toEqual(['lot-bad']);
  });

  it('uses the current time when none is given', async () => {
    prisma.coinLot.findMany.mockResolvedValue([]);
    await sweep.expireDue();

    const [[{ where }]] = prisma.coinLot.findMany.mock.calls as [[{ where: { expiresAt: { lte: Date } } }]];
    expect(where.expiresAt.lte).toBeInstanceOf(Date);
  });
});
