import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from './coin-spend.service';
import { WalletService } from './wallet.service';

describe('WalletService.plannedSplit', () => {
  const service = new WalletService(
    {} as unknown as PrismaService,
    {} as unknown as PlatformSettingService,
    {} as unknown as CoinSpendService,
  );

  it('takes main Coins first, then bonus Coins', () => {
    expect(service.plannedSplit(10, 40, 25)).toEqual({ mainCoins: 10, bonusCoins: 15 });
  });

  it('never takes more main Coins than the price', () => {
    expect(service.plannedSplit(100, 5, 25)).toEqual({ mainCoins: 25, bonusCoins: 0 });
  });

  it('plans nothing when the wallet is empty', () => {
    expect(service.plannedSplit(0, 0, 25)).toEqual({ mainCoins: 0, bonusCoins: 0 });
  });
});

describe('WalletService.affordability', () => {
  const prisma = {
    coinWallet: { upsert: jest.fn() },
    coinLot: { findMany: jest.fn(), aggregate: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const coins = { credit: jest.fn(), spend: jest.fn() };
  const service = new WalletService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    coins as unknown as CoinSpendService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coinWallet.upsert.mockResolvedValue({ id: 'w1', mainBalance: 10, bonusBalance: 40 });
    prisma.coinLot.aggregate.mockResolvedValue({ _sum: { remainingAmount: 40 } });
  });

  it('reports the gap exactly when the wallet is short', async () => {
    await expect(service.affordability('u1', 25)).resolves.toMatchObject({
      requiredCoins: 25,
      mainBalance: 10,
      bonusBalance: 40,
      enoughCoins: true,
      missingCoins: 0,
      plannedSplit: { mainCoins: 10, bonusCoins: 15 },
    });
  });

  it('counts only lots that have not run out yet', async () => {
    prisma.coinLot.aggregate.mockResolvedValue({ _sum: { remainingAmount: 5 } });
    await expect(service.affordability('u1', 25)).resolves.toMatchObject({
      enoughCoins: false,
      missingCoins: 10,
    });
  });

  it('assertAffordable throws the 422 the purchase screens answer with', async () => {
    prisma.coinLot.aggregate.mockResolvedValue({
      _sum: {
        remainingAmount: 5,
      },
    });

    await expect(service.assertAffordable('u1', 25)).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'INSUFFICIENT_COINS',
        },
      },
    });
  });

  it('assertAffordable returns the split when the price is covered', async () => {
    await expect(service.assertAffordable('u1', 25)).resolves.toEqual({ mainCoins: 10, bonusCoins: 15 });
  });
});

describe('WalletService.view', () => {
  const prisma = {
    coinWallet: { upsert: jest.fn() },
    coinLot: { findMany: jest.fn(), aggregate: jest.fn() },
  };
  const service = new WalletService(
    prisma as unknown as PrismaService,
    {} as unknown as PlatformSettingService,
    {} as unknown as CoinSpendService,
  );

  it('shows the two balances apart, with what runs out first', async () => {
    prisma.coinWallet.upsert.mockResolvedValue({ id: 'w1', mainBalance: 120, bonusBalance: 40, version: 7 });
    prisma.coinLot.findMany.mockResolvedValue([
      { id: 'lot-1', remainingAmount: 40, expiresAt: new Date('2026-11-04T00:00:00.000Z') },
    ]);

    await expect(service.view('u1')).resolves.toEqual({
      mainBalance: 120,
      bonusBalance: 40,
      version: 7,
      expiringBonus: [{ lotId: 'lot-1', amount: 40, expiresAt: new Date('2026-11-04T00:00:00.000Z') }],
    });
    expect(prisma.coinLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ walletId: 'w1' }) }),
    );
  });
});

describe('WalletService.openForNewAccount', () => {
  const tx = { coinWallet: { create: jest.fn() } };
  const settings = { get: jest.fn() };
  const coins = { credit: jest.fn() };
  const service = new WalletService(
    {} as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    coins as unknown as CoinSpendService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.coinWallet.create.mockResolvedValue({ id: 'w-new' });
  });

  it('pays the welcome bonus into the fresh wallet (step 5)', async () => {
    settings.get.mockResolvedValue({ newMemberBonusCoins: 50 });

    const wallet = await service.openForNewAccount(tx as unknown as PrismaTx, 'u-new');

    expect(wallet).toEqual({ id: 'w-new' });
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w-new',
      expect.objectContaining({ entryType: 'SIGNUP_BONUS', bonusAmount: 50 }),
      expect.any(Date),
    );
  });

  it('opens the wallet with no bonus when the platform pays none', async () => {
    settings.get.mockResolvedValue({ newMemberBonusCoins: 0 });

    await service.openForNewAccount(tx as unknown as PrismaTx, 'u-new');

    expect(tx.coinWallet.create).toHaveBeenCalledWith({ data: { userId: 'u-new' } });
    expect(coins.credit).not.toHaveBeenCalled();
  });
});
