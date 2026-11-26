import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { CoinRefundService } from '../coin-wallet/coin-refund.service';
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
    {} as unknown as CoinRefundService,
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
    $queryRaw: jest.fn(),
    episodeAccess: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const wallets = { walletOf: jest.fn() };
  const coins = { credit: jest.fn() };
  const refunds = { refundPayment: jest.fn() };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new EntitlementService(
    {} as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    refunds as unknown as CoinRefundService,
    wallets as unknown as WalletService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );
  const bought = (id: string, paidCoins: number, coinTransactionId: string | null) => ({
    id,
    userId: 'u1',
    paidCoins,
    coinTransactionId,
    episode: { movieId: 'm1' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    tx.episodeAccess.updateMany.mockResolvedValue({ count: 1 });
    coins.credit.mockResolvedValue({ transactionId: 'tx-r' });
    refunds.refundPayment.mockResolvedValue({
      alreadyRefunded: false,
      refundTransactionId: 'tx-r',
      mainCoins: 10,
      bonusCoins: 15,
    });
  });

  it('pays every buyer back through the payment refund and revokes the unlocks (BR-52)', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([bought('a1', 25, 'tx-0'), bought('a2', 0, null)]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(2);

    expect(refunds.refundPayment).toHaveBeenCalledTimes(1);
    expect(refunds.refundPayment).toHaveBeenCalledWith(tx, 'tx-0', {
      description: 'Refund: the content was taken down for good (REMOVAL)',
      revokeReason: 'REMOVAL',
    });
    expect(coins.credit).not.toHaveBeenCalled();
    expect(tx.episodeAccess.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.episodeAccess.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: 'REMOVAL' },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.EPISODE_ACCESS_REVOKED,
        entityType: 'EpisodeAccess',
        projectId: 'm1',
        payload: expect.objectContaining({ refundedCoins: 25, transactionId: 'tx-r' }),
      }),
      tx,
    );
    // Only the member who got Coins back is told so.
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
  });

  it('locks the wallet before claiming the unlock, the order an Admin refund takes', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([bought('a1', 25, 'tx-0')]);

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    const [lock] = tx.$queryRaw.mock.invocationCallOrder;
    const [claim] = tx.episodeAccess.updateMany.mock.invocationCallOrder;
    expect(lock).toBeLessThan(claim);
  });

  it('pays nothing again for a purchase an Admin already refunded, but still revokes it', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([bought('a1', 25, 'tx-0')]);
    refunds.refundPayment.mockResolvedValue({ alreadyRefunded: true, refundTransactionId: 'tx-old' });

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    expect(tx.episodeAccess.updateMany).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ refundedCoins: 0 }) }),
      tx,
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('skips an unlock revoked meanwhile (an Admin refund got there first)', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([bought('a1', 25, 'tx-0')]);
    tx.episodeAccess.updateMany.mockResolvedValue({ count: 0 });

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    expect(refunds.refundPayment).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('pays the whole price back as main Coins when the purchase entry is unknown', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([bought('a3', 25, null)]);

    await service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL');

    expect(refunds.refundPayment).not.toHaveBeenCalled();
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ mainAmount: 25, referenceType: 'EPISODE_ACCESS', referenceId: 'a3' }),
    );
  });

  it('finds nobody to pay back when nothing was bought', async () => {
    tx.episodeAccess.findMany.mockResolvedValue([]);

    await expect(service.refundEpisodeRemoval(tx as never, 'ep-1', 'REMOVAL')).resolves.toBe(0);
    expect(refunds.refundPayment).not.toHaveBeenCalled();
  });
});
