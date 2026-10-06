import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { SeriesPurchaseService } from './series-purchase.service';

describe('SeriesPurchaseService.purchase', () => {
  const tx = {
    seriesAccess: { count: jest.fn(), create: jest.fn() },
    subscription: { count: jest.fn() },
    episodeAccess: { count: jest.fn() },
    episode: { count: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    movie: { findFirst: jest.fn() },
    coinTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const settings = { get: jest.fn().mockResolvedValue({ coinRateVnd: 1000 }) };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SeriesPurchaseService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    auditLog as unknown as AuditLogService,
  );

  const user = { id: 'u1' } as unknown as AuthenticatedUser;
  const movie = { id: 'm1', seriesCoinPrice: 180 };
  const movement = { transactionId: 'tx-1', mainCoins: 100, bonusCoins: 80, mainBalance: 0, bonusBalance: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    settings.get.mockResolvedValue({ coinRateVnd: 1000 });
    prisma.movie.findFirst.mockResolvedValue(movie);
    prisma.coinTransaction.findUnique.mockResolvedValue(null);
    tx.seriesAccess.count.mockResolvedValue(0);
    tx.subscription.count.mockResolvedValue(0);
    tx.episodeAccess.count.mockResolvedValue(0);
    tx.episode.count.mockResolvedValue(12);
    coins.spend.mockResolvedValue(movement);
    tx.seriesAccess.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'access-1',
      grantedAt: new Date('2026-10-05T00:00:00.000Z'),
      ...data,
    }));
  });

  it('unlocks the whole movie at once, later episodes included', async () => {
    const result = await service.purchase('m1', user, 'key-1');

    expect(coins.spend).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'SERIES_PURCHASE', amountCoins: 180, idempotencyKey: 'key-1' }),
    );
    expect(tx.seriesAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        movieId: 'm1',
        source: 'SERIES_PURCHASE',
        paidCoins: 180,
        coinTransactionId: 'tx-1',
      }),
    });
    expect(result).toMatchObject({
      movieId: 'm1',
      paidCoins: 180,
      accessGranted: true,
      unlockedEpisodes: 12,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SERIES_ACCESS_GRANTED, entityType: 'SeriesAccess' }),
      tx,
    );
  });

  it('replays the same key instead of charging twice', async () => {
    prisma.coinTransaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      mainAmount: -100,
      bonusAmount: -80,
      mainBalanceAfter: 0,
      bonusBalanceAfter: 0,
      seriesAccess: { userId: 'u1', movieId: 'm1', paidCoins: 180, source: 'SERIES_PURCHASE', grantedAt: new Date() },
    });

    const result = await service.purchase('m1', user, 'key-1');

    expect(result).toMatchObject({ accessGranted: true, idempotent: true });
    expect(coins.spend).not.toHaveBeenCalled();
  });

  it.each([[null], [{ id: 'm1', seriesCoinPrice: null }]])(
    'refuses a movie that is not sold as a series (%p)',
    async (row) => {
      prisma.movie.findFirst.mockResolvedValue(row);

      await expect(service.purchase('m1', user)).rejects.toMatchObject({
        response: {
          statusCode: 422,
          details: {
            reason: 'SERIES_NOT_SOLD',
          },
        },
      });

      expect(coins.spend).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['the bundle itself', { seriesAccess: 1, plan: 0, ownedEpisodes: 0 }],
    ['a running plan', { seriesAccess: 0, plan: 1, ownedEpisodes: 0 }],
    ['a single bought episode', { seriesAccess: 0, plan: 0, ownedEpisodes: 1 }],
  ])('refuses when %s already opens the movie', async (_label, counts) => {
    tx.seriesAccess.count.mockResolvedValue(counts.seriesAccess);
    tx.subscription.count.mockResolvedValue(counts.plan);
    tx.episodeAccess.count.mockResolvedValue(counts.ownedEpisodes);

    await expect(service.purchase('m1', user)).rejects.toMatchObject({
      response: {
        statusCode: 409,
        details: {
          reason: 'SERIES_ACCESS_ALREADY_OWNED',
        },
      },
    });

    expect(coins.spend).not.toHaveBeenCalled();
  });
});
