import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { EntitlementService } from './entitlement.service';

describe('EntitlementService.listFor', () => {
  const prisma = {
    episodeAccess: { findMany: jest.fn(), count: jest.fn() },
    seriesAccess: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new EntitlementService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as NotificationService,
    {} as unknown as AuditLogService,
  );

  const query = { path: '' } as never;
  const episodeRow = {
    id: 'access-1',
    source: 'EPISODE_PURCHASE',
    paidCoins: 25,
    grantedAt: new Date('2026-10-05T00:00:00.000Z'),
    episode: { id: 'ep-1', movie: { id: 'm1', title: 'M1' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodeAccess.findMany.mockResolvedValue([episodeRow]);
    prisma.episodeAccess.count.mockResolvedValue(1);
    prisma.seriesAccess.findMany.mockResolvedValue([]);
  });

  it('lists bought episodes with just enough card data, plus the bundles', async () => {
    const result = await service.listFor({ userId: 'u1' }, query);

    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(result.episodes.data).toEqual([
      {
        id: 'access-1',
        source: 'EPISODE_PURCHASE',
        paidCoins: 25,
        grantedAt: episodeRow.grantedAt,
        episode: episodeRow.episode,
        movie: { id: 'm1', title: 'M1' },
      },
    ]);
    expect(result.series).toEqual([]);
  });

  it('forwards the source filter to both lists', async () => {
    await service.listFor({ userId: 'u1', source: 'SERIES_PURCHASE' }, query);

    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'SERIES_PURCHASE' }) }),
    );
    expect(prisma.seriesAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'SERIES_PURCHASE' }) }),
    );
  });
});

describe('EntitlementService refunds', () => {
  const tx = {
    episodeAccess: { findMany: jest.fn(), update: jest.fn() },
    seriesAccess: { findMany: jest.fn(), update: jest.fn() },
  };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const coins = { credit: jest.fn().mockResolvedValue({ transactionId: 'tx-r' }) };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new EntitlementService(
    {} as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    coins.credit.mockResolvedValue({ transactionId: 'tx-r' });
  });

  it('pays episode buyers back into main Coins and revokes the rows (BR-52)', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([
      { id: 'a1', userId: 'u1', paidCoins: 25, coinTransactionId: 'tx-0', episode: { movieId: 'm1' } },
      { id: 'a2', userId: 'u2', paidCoins: 0, coinTransactionId: null, episode: { movieId: 'm1' } },
    ]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(2);

    expect(coins.credit).toHaveBeenCalledTimes(1);
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'REFUND', mainAmount: 25, reversesId: 'tx-0' }),
    );
    expect(tx.episodeAccess.update).toHaveBeenCalledTimes(2);
    expect(tx.episodeAccess.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { revokedAt: expect.any(Date), revokeReason: 'REMOVAL' },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.EPISODE_ACCESS_REVOKED,
        entityType: 'EpisodeAccess',
        movieId: 'm1',
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
  });

  it('pays series buyers back the same way', async () => {
    tx.seriesAccess.findMany.mockResolvedValue([
      { id: 's1', userId: 'u1', movieId: 'm1', paidCoins: 180, coinTransactionId: 'tx-0' },
    ]);

    await expect(service.refundSeriesRemoval(tx as never, 'm1', 'REMOVAL')).resolves.toBe(1);

    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'REFUND', mainAmount: 180 }),
    );
    expect(tx.seriesAccess.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { revokedAt: expect.any(Date), revokeReason: 'REMOVAL' },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.SERIES_ACCESS_REVOKED,
        entityType: 'SeriesAccess',
        movieId: 'm1',
      }),
      tx,
    );
  });

  it('finds nobody to pay back when nothing was bought', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([]);
    tx.seriesAccess.findMany.mockResolvedValue([]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(0);
    await expect(service.refundSeriesRemoval(tx as never, 'm1', 'REMOVAL')).resolves.toBe(0);
    expect(coins.credit).not.toHaveBeenCalled();
  });
});
