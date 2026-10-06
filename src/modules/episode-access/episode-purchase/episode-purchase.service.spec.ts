import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { EpisodePurchaseService } from './episode-purchase.service';

describe('EpisodePurchaseService.purchase', () => {
  const tx = {
    episodeAccess: { count: jest.fn(), create: jest.fn() },
    seriesAccess: { count: jest.fn() },
    subscription: { count: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    episode: { findFirst: jest.fn() },
    coinTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const settings = { get: jest.fn().mockResolvedValue({ freeStarterEpisodeCount: 2, coinRateVnd: 1000 }) };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new EpisodePurchaseService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    auditLog as unknown as AuditLogService,
  );

  const user = { id: 'u1' } as unknown as AuthenticatedUser;
  const episode = { id: 'ep-1', movieId: 'm1', episodeNumber: 5, coinPrice: 25 };
  const movement = { transactionId: 'tx-1', mainCoins: 10, bonusCoins: 15, mainBalance: 0, bonusBalance: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ freeStarterEpisodeCount: 2, coinRateVnd: 1000 });
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    prisma.episode.findFirst.mockResolvedValue(episode);
    prisma.coinTransaction.findUnique.mockResolvedValue(null);
    tx.episodeAccess.count.mockResolvedValue(0);
    tx.seriesAccess.count.mockResolvedValue(0);
    tx.subscription.count.mockResolvedValue(0);
    coins.spend.mockResolvedValue(movement);
    tx.episodeAccess.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'access-1',
      grantedAt: new Date('2026-10-05T00:00:00.000Z'),
      ...data,
    }));
  });

  it('unlocks one episode with main Coins before bonus Coins (step 17)', async () => {
    const result = await service.purchase('ep-1', user, 'key-1');

    expect(coins.spend).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'EPISODE_PURCHASE', amountCoins: 25, idempotencyKey: 'key-1' }),
    );
    expect(tx.episodeAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        episodeId: 'ep-1',
        source: 'EPISODE_PURCHASE',
        paidCoins: 25,
        coinTransactionId: 'tx-1',
      }),
    });
    expect(result).toMatchObject({
      episodeId: 'ep-1',
      paidCoins: 25,
      charged: { mainCoins: 10, bonusCoins: 15 },
      accessGranted: true,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.EPISODE_ACCESS_GRANTED,
        entityType: 'EpisodeAccess',
        actorId: 'u1',
      }),
      tx,
    );
  });

  it('replays the same key instead of charging twice', async () => {
    prisma.coinTransaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      mainAmount: -10,
      bonusAmount: -15,
      mainBalanceAfter: 0,
      bonusBalanceAfter: 0,
      episodeAccess: {
        userId: 'u1',
        episodeId: 'ep-1',
        paidCoins: 25,
        source: 'EPISODE_PURCHASE',
        grantedAt: new Date(),
      },
    });

    const result = await service.purchase('ep-1', user, 'key-1');

    expect(result).toMatchObject({ accessGranted: true, idempotent: true, paidCoins: 25 });
    expect(coins.spend).not.toHaveBeenCalled();
    expect(tx.episodeAccess.create).not.toHaveBeenCalled();
  });

  it('refuses an episode that is not published', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.purchase('missing', user)).rejects.toMatchObject({
      response: {
        statusCode: 409,
        details: {
          reason: 'EPISODE_NOT_PUBLISHED',
        },
      },
    });
  });

  it('refuses an episode with no price', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      ...episode,
      coinPrice: null,
    });

    await expect(service.purchase('ep-1', user)).rejects.toMatchObject({
      response: {
        details: {
          reason: 'EPISODE_NOT_PRICED',
        },
      },
    });
  });

  it.each([
    ['a Free Starter', { ...episode, episodeNumber: 1 }],
    ['priced at zero', { ...episode, coinPrice: 0 }],
  ])('refuses %s: there is nothing to buy', async (_label, row) => {
    prisma.episode.findFirst.mockResolvedValue(row);

    await expect(service.purchase('ep-1', user)).rejects.toMatchObject({
      response: {
        details: {
          reason: 'ACCESS_ALREADY_OWNED',
        },
      },
    });

    expect(coins.spend).not.toHaveBeenCalled();
  });

  it.each([
    ['the episode itself', { episodeAccess: 1, seriesAccess: 0, plan: 0 }],
    ['the whole series', { episodeAccess: 0, seriesAccess: 1, plan: 0 }],
    ['a running plan', { episodeAccess: 0, seriesAccess: 0, plan: 1 }],
  ])('refuses when %s already opens the episode', async (_label, counts) => {
    tx.episodeAccess.count.mockResolvedValue(counts.episodeAccess);
    tx.seriesAccess.count.mockResolvedValue(counts.seriesAccess);
    tx.subscription.count.mockResolvedValue(counts.plan);

    await expect(service.purchase('ep-1', user)).rejects.toMatchObject({
      response: {
        details: {
          reason: 'ACCESS_ALREADY_OWNED',
        },
      },
    });

    expect(coins.spend).not.toHaveBeenCalled();
  });
});
