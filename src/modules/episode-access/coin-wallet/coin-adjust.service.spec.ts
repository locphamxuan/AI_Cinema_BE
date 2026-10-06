import { ConflictException } from '@nestjs/common';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinAdjustService } from './coin-adjust.service';

describe('CoinAdjustService.apply', () => {
  const tx = {
    $queryRaw: jest.fn(),
    coinWallet: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinLot: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), create: jest.fn() },
    coinTransaction: { createManyAndReturn: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ coinRateVnd: 1000, bonusCoinExpiryDays: 30 }) };
  const service = new CoinAdjustService(settings as unknown as PlatformSettingService);

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ coinRateVnd: 1000, bonusCoinExpiryDays: 30 });
    tx.coinWallet.findUniqueOrThrow.mockResolvedValue({ id: 'w1', mainBalance: 10, bonusBalance: 5 });
    tx.coinWallet.updateMany.mockResolvedValue({ count: 1 });
    tx.coinTransaction.createManyAndReturn.mockResolvedValue([{ id: 'tx-a' }, { id: 'tx-b' }]);
  });

  it('refuses a correction that moves nothing (BR-20)', async () => {
    await expect(service.apply(tx as unknown as PrismaTx, 'w1', { reason: 'oops' })).rejects.toThrow(ConflictException);
  });

  it('refuses to mix a main move into a bonus debit', async () => {
    await expect(
      service.apply(tx as unknown as PrismaTx, 'w1', {
        mainAmount: 5,
        bonusAmount: -5,
        reason: 'split me',
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        details: {
          reason: 'SPLIT_THE_CORRECTION',
        },
      },
    });
  });

  it('credits main Coins with one ADJUSTMENT row', async () => {
    const movement = await service.apply(tx as unknown as PrismaTx, 'w1', { mainAmount: 100, reason: '  comp  ' });

    expect(movement).toMatchObject({ transactionId: 'tx-a', mainCoins: 100, bonusCoins: 0, mainBalance: 110 });
    expect(tx.coinTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [expect.objectContaining({ entryType: 'ADJUSTMENT', mainAmount: 100, description: 'comp' })],
    });
  });

  it('never lets a main debit take the wallet below zero', async () => {
    await expect(
      service.apply(tx as unknown as PrismaTx, 'w1', {
        mainAmount: -11,
        reason: 'too much',
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'INSUFFICIENT_COINS',
          requiredCoins: 11,
        },
      },
    });

    expect(tx.coinTransaction.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('takes a bonus debit out of the lots first to expire, one row per lot', async () => {
    tx.coinLot.findMany.mockResolvedValue([
      { id: 'lot-a', remainingAmount: 3 },
      { id: 'lot-b', remainingAmount: 10 },
    ]);

    const movement = await service.apply(tx as unknown as PrismaTx, 'w1', { bonusAmount: -5, reason: 'recall' });

    expect(movement).toMatchObject({ mainCoins: 0, bonusCoins: 5, bonusBalance: 0 });
    expect(tx.coinTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ bonusAmount: -3, lotId: 'lot-a', idempotencyKey: undefined }),
        expect.objectContaining({ bonusAmount: -2, lotId: 'lot-b', idempotencyKey: null }),
      ],
    });
    expect(tx.coinLot.create).not.toHaveBeenCalled();
  });

  it('refuses a bonus debit the lots cannot cover', async () => {
    tx.coinLot.findMany.mockResolvedValue([
      {
        id: 'lot-a',
        remainingAmount: 2,
      },
    ]);

    await expect(
      service.apply(tx as unknown as PrismaTx, 'w1', {
        bonusAmount: -5,
        reason: 'recall',
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'INSUFFICIENT_COINS',
          missingCoins: 3,
        },
      },
    });
  });

  it('parks a bonus credit in a fresh lot', async () => {
    tx.coinLot.create.mockResolvedValue({ id: 'lot-new' });

    await service.apply(tx as unknown as PrismaTx, 'w1', { bonusAmount: 20, reason: 'promo' });

    expect(tx.coinLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ walletId: 'w1', originalAmount: 20, source: 'ADJUSTMENT' }),
    });
  });
});
