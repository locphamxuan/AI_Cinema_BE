import { ConflictException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from './coin-spend.service';

describe('CoinSpendService.spend', () => {
  const tx = {
    $queryRaw: jest.fn(),
    coinWallet: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinLot: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    coinTransaction: { findUnique: jest.fn().mockResolvedValue(null), createManyAndReturn: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ coinRateVnd: 1000 }) };
  const service = new CoinSpendService({} as unknown as PrismaService, settings as unknown as PlatformSettingService);

  const spendRequest = (amountCoins: number) => ({
    entryType: CoinEntryType.EPISODE_PURCHASE,
    amountCoins,
    coinRateVnd: 1000,
    description: 'Unlocked one episode',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ coinRateVnd: 1000 });
    tx.coinWallet.updateMany.mockResolvedValue({ count: 1 });
    tx.coinTransaction.findUnique.mockResolvedValue(null);
  });

  it('takes main Coins before bonus Coins and explains every part in the ledger', async () => {
    tx.coinWallet.findUniqueOrThrow.mockResolvedValue({ id: 'w1', mainBalance: 10, bonusBalance: 40 });
    tx.coinLot.findMany.mockResolvedValue([{ id: 'lot-1', remainingAmount: 40 }]);
    tx.coinLot.update.mockResolvedValue({});
    tx.coinTransaction.createManyAndReturn.mockResolvedValue([{ id: 'tx-1' }, { id: 'tx-2' }]);

    const movement = await service.spend(tx as unknown as PrismaTx, 'w1', spendRequest(25));

    expect(movement).toEqual({
      transactionId: 'tx-1',
      mainCoins: 10,
      bonusCoins: 15,
      mainBalance: 0,
      bonusBalance: 25,
    });
    expect(tx.coinTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ mainAmount: -10, bonusAmount: 0, idempotencyKey: undefined }),
        expect.objectContaining({ mainAmount: 0, bonusAmount: -15, lotId: 'lot-1', idempotencyKey: null }),
      ],
    });
    expect(tx.coinWallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { mainBalance: 0, bonusBalance: 25, version: { increment: 1 } },
    });
  });

  it('replays the same idempotency key instead of charging again', async () => {
    tx.coinTransaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      mainAmount: -10,
      bonusAmount: -15,
      mainBalanceAfter: 0,
      bonusBalanceAfter: 25,
    });

    const movement = await service.spend(tx as unknown as PrismaTx, 'w1', {
      ...spendRequest(25),
      idempotencyKey: 'key-1',
    });

    expect(movement).toEqual({
      transactionId: 'tx-1',
      mainCoins: 10,
      bonusCoins: 15,
      mainBalance: 0,
      bonusBalance: 25,
    });
    expect(tx.coinTransaction.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('refuses a wallet that cannot cover the price, with the gap spelled out', async () => {
    tx.coinWallet.findUniqueOrThrow.mockResolvedValue({
      id: 'w1',
      mainBalance: 10,
      bonusBalance: 40,
    });

    tx.coinLot.findMany.mockResolvedValue([
      {
        id: 'lot-1',
        remainingAmount: 5,
      },
    ]);

    await expect(service.spend(tx as unknown as PrismaTx, 'w1', spendRequest(25))).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'INSUFFICIENT_COINS',
          requiredCoins: 25,
          mainBalance: 10,
          bonusBalance: 5,
          missingCoins: 10,
        },
      },
    });

    expect(tx.coinTransaction.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('refuses a payment of nothing (BR-45)', async () => {
    await expect(service.spend(tx as unknown as PrismaTx, 'w1', spendRequest(0))).rejects.toThrow(ConflictException);
  });
});

describe('CoinSpendService.credit', () => {
  const tx = {
    $queryRaw: jest.fn(),
    coinWallet: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinLot: { create: jest.fn() },
    coinTransaction: { findUnique: jest.fn().mockResolvedValue(null), createManyAndReturn: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ coinRateVnd: 1000, bonusCoinExpiryDays: 30 }) };
  const service = new CoinSpendService({} as unknown as PrismaService, settings as unknown as PlatformSettingService);

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ coinRateVnd: 1000, bonusCoinExpiryDays: 30 });
    tx.coinWallet.findUniqueOrThrow.mockResolvedValue({ id: 'w1', mainBalance: 0, bonusBalance: 0 });
    tx.coinWallet.updateMany.mockResolvedValue({ count: 1 });
    tx.coinTransaction.findUnique.mockResolvedValue(null);
    tx.coinTransaction.createManyAndReturn.mockResolvedValue([{ id: 'tx-9' }]);
  });

  it('credits main Coins without opening a lot', async () => {
    const movement = await service.credit(tx as unknown as PrismaTx, 'w1', {
      entryType: CoinEntryType.TOP_UP,
      mainAmount: 50,
      lotSource: CoinLotSource.TOP_UP_PROMO,
      rateVnd: 1000,
    });

    expect(movement).toMatchObject({ transactionId: 'tx-9', mainCoins: 50, bonusCoins: 0, mainBalance: 50 });
    expect(tx.coinLot.create).not.toHaveBeenCalled();
  });

  it('parks bonus Coins in a lot that knows when it runs out', async () => {
    tx.coinLot.create.mockResolvedValue({ id: 'lot-9' });

    await service.credit(tx as unknown as PrismaTx, 'w1', {
      entryType: CoinEntryType.DAILY_REWARD,
      bonusAmount: 5,
      lotSource: CoinLotSource.DAILY_REWARD,
    });

    expect(tx.coinLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ walletId: 'w1', originalAmount: 5, remainingAmount: 5 }),
    });
    expect(tx.coinTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [expect.objectContaining({ bonusAmount: 5, lotId: 'lot-9' })],
    });
  });

  it('refuses to credit nothing', async () => {
    await expect(
      service.credit(tx as unknown as PrismaTx, 'w1', {
        entryType: CoinEntryType.TOP_UP,
        lotSource: CoinLotSource.TOP_UP_PROMO,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('CoinSpendService.expireBonus', () => {
  const tx = {
    $queryRaw: jest.fn(),
    coinWallet: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinTransaction: { createManyAndReturn: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ coinRateVnd: 1000 }) };
  const service = new CoinSpendService({} as unknown as PrismaService, settings as unknown as PlatformSettingService);

  it('writes one BONUS_EXPIRY row and leaves main Coins alone (BR-28)', async () => {
    tx.coinWallet.findUniqueOrThrow.mockResolvedValue({ id: 'w1', mainBalance: 5, bonusBalance: 10 });
    tx.coinTransaction.createManyAndReturn.mockResolvedValue([{ id: 'tx-e' }]);

    const movement = await service.expireBonus(tx as unknown as PrismaTx, 'w1', {
      id: 'lot-e',
      amount: 4,
      expiresAt: new Date('2026-10-05T00:00:00.000Z'),
    });

    expect(movement).toMatchObject({ mainCoins: 0, bonusCoins: 4, mainBalance: 5, bonusBalance: 6 });
    expect(tx.coinTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entryType: CoinEntryType.BONUS_EXPIRY,
          mainAmount: 0,
          bonusAmount: -4,
          lotId: 'lot-e',
        }),
      ],
    });
  });
});
