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
  });

  it('lists bought episodes with just enough card data', async () => {
    const result = await service.listFor({ userId: 'u1' }, query);

    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(result.data).toEqual([
      {
        id: 'access-1',
        source: 'EPISODE_PURCHASE',
        paidCoins: 25,
        grantedAt: episodeRow.grantedAt,
        episode: episodeRow.episode,
        movie: { id: 'm1', title: 'M1' },
      },
    ]);
  });

  it('forwards the source filter', async () => {
    await service.listFor({ userId: 'u1', source: 'ADMIN_GRANT' }, query);

    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'ADMIN_GRANT' }) }),
    );
  });
});

describe('EntitlementService refunds', () => {
  const tx = {
    episodeAccess: { findMany: jest.fn(), update: jest.fn() },
    coinTransaction: { findUnique: jest.fn() },
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
    // The first row of a debit: the main part only, the bonus part sits on the lot rows after it.
    tx.coinTransaction.findUnique.mockResolvedValue({ mainAmount: -10 });
  });

  it('pays episode buyers back main and bonus as they paid, and revokes the rows (BR-52)', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([
      { id: 'a1', userId: 'u1', paidCoins: 25, coinTransactionId: 'tx-0', episode: { movieId: 'm1' } },
      { id: 'a2', userId: 'u2', paidCoins: 0, coinTransactionId: null, episode: { movieId: 'm1' } },
    ]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(2);

    expect(coins.credit).toHaveBeenCalledTimes(1);
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'REFUND', mainAmount: 10, bonusAmount: 15, reversesId: 'tx-0' }),
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
        projectId: 'm1',
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
  });

  it('pays back a purchase made only of bonus Coins as bonus Coins', async () => {
    // Main balance was 0: the first row moved no main Coin, every Coin came from the lots.
    tx.coinTransaction.findUnique.mockResolvedValue({ mainAmount: 0 });
    tx.episodeAccess.findMany.mockResolvedValue([
      { id: 'a4', userId: 'u1', paidCoins: 25, coinTransactionId: 'tx-4', episode: { movieId: 'm1' } },
    ]);

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    expect(coins.credit).toHaveBeenCalledWith(tx, 'w1', expect.objectContaining({ mainAmount: 0, bonusAmount: 25 }));
  });

  it('pays the whole price back as main Coins when the purchase entry is unknown', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([
      { id: 'a3', userId: 'u1', paidCoins: 25, coinTransactionId: null, episode: { movieId: 'm1' } },
    ]);

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    expect(coins.credit).toHaveBeenCalledWith(tx, 'w1', expect.objectContaining({ mainAmount: 25, bonusAmount: 0 }));
  });

  it('finds nobody to pay back when nothing was bought', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(0);
    expect(coins.credit).not.toHaveBeenCalled();
  });
});
