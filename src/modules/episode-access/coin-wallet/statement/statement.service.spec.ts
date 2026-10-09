import { NotFoundException } from '@nestjs/common';
import { CoinEntryType } from '@prisma/client';
import type { PaginateQuery } from '@nestarc/pagination';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { WalletService } from '../wallet.service';
import { StatementService } from './statement.service';

describe('StatementService.history', () => {
  const prisma = { coinTransaction: { findMany: jest.fn(), count: jest.fn() } };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const service = new StatementService(prisma as unknown as PrismaService, wallets as unknown as WalletService);

  const entry = {
    id: 'tx-1',
    entryType: CoinEntryType.EPISODE_PURCHASE,
    mainAmount: -10,
    bonusAmount: -15,
    rateVnd: 1000,
    description: 'Unlocked one episode',
    referenceType: 'EPISODE_ACCESS',
    referenceId: 'access-1',
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    mainBalanceAfter: 0,
    bonusBalanceAfter: 25,
  };
  const query = { path: '', page: 1, limit: 10 } as PaginateQuery;

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    prisma.coinTransaction.findMany.mockResolvedValue([entry]);
    prisma.coinTransaction.count.mockResolvedValue(1);
  });

  it('reads one wallet straight from the ledger, balances included', async () => {
    const page = await service.history({ userId: 'u1', kind: 'ALL' }, query);

    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ walletId: 'w1' }) }),
    );
    expect(page.data).toEqual([
      {
        id: 'tx-1',
        entryType: CoinEntryType.EPISODE_PURCHASE,
        mainAmount: -10,
        bonusAmount: -15,
        rateVnd: 1000,
        description: 'Unlocked one episode',
        referenceType: 'EPISODE_ACCESS',
        referenceId: 'access-1',
        createdAt: entry.createdAt,
        mainBalanceAfter: 0,
        bonusBalanceAfter: 25,
      },
    ]);
  });

  it('narrows MAIN lines to rows that moved main Coins', async () => {
    await service.history({ userId: 'u1', kind: 'MAIN', entryType: CoinEntryType.TOP_UP }, query);

    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletId: 'w1',
          mainAmount: { ne: 0 },
          entryType: CoinEntryType.TOP_UP,
        }),
      }),
    );
  });
});

describe('StatementService.line', () => {
  const prisma = { coinTransaction: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() } };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const service = new StatementService(prisma as unknown as PrismaService, wallets as unknown as WalletService);

  it('shows one ledger line with the balances right after it', async () => {
    prisma.coinTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      entryType: CoinEntryType.TOP_UP,
      mainAmount: 50,
      bonusAmount: 0,
      rateVnd: 1000,
      description: 'Top-up',
      referenceType: 'COIN_TOP_UP',
      referenceId: 'topup-1',
      createdAt: new Date(),
      mainBalanceAfter: 50,
      bonusBalanceAfter: 0,
      reversesId: null,
      lotId: null,
    });

    await expect(service.line('u1', 'tx-1')).resolves.toMatchObject({
      id: 'tx-1',
      walletId: 'w1',
      mainBalanceAfter: 50,
      reversesId: null,
      lotId: null,
    });
    expect(prisma.coinTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: 'tx-1', walletId: 'w1' },
    });
  });

  it('hides other members’ lines behind a 404', async () => {
    prisma.coinTransaction.findFirst.mockResolvedValue(null);
    await expect(service.line('u1', 'missing')).rejects.toThrow(NotFoundException);
  });
});

describe('StatementService.ledger', () => {
  const prisma = { coinTransaction: { findMany: jest.fn(), count: jest.fn() } };
  const wallets = { walletOf: jest.fn() };
  const service = new StatementService(prisma as unknown as PrismaService, wallets as unknown as WalletService);
  const query = { path: '', page: 1, limit: 10 } as PaginateQuery;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coinTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        entryType: CoinEntryType.TOP_UP,
        mainAmount: 50,
        bonusAmount: 0,
        rateVnd: 1000,
        description: 'Top-up',
        referenceType: 'COIN_TOP_UP',
        referenceId: 'topup-1',
        createdAt: new Date('2026-10-05T00:00:00.000Z'),
        mainBalanceAfter: 50,
        bonusBalanceAfter: 0,
        walletId: 'w1',
        wallet: { userId: 'u1' },
      },
    ]);
    prisma.coinTransaction.count.mockResolvedValue(1);
  });

  it('tags every platform line with its wallet and owner', async () => {
    const page = await service.ledger({ kind: 'ALL', walletId: 'w1' }, query);

    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ walletId: 'w1' }) }),
    );
    expect(page.data).toEqual([expect.objectContaining({ id: 'tx-1', walletId: 'w1', userId: 'u1', mainAmount: 50 })]);
  });
});
