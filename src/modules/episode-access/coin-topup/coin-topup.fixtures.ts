import { PaymentProvider, PaymentStatus, TopUpStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { CoinTopUpService } from './coin-topup.service';

/** Shared fixtures for `coin-topup.service.spec.ts`. Fresh mocks per factory call. */
export const SETTINGS_VALUE = { coinTopUpMinVnd: 10000, coinTopUpMaxVnd: 2000000, coinRateVnd: 1000 };

export const MOVEMENT = { transactionId: 'tx-1', mainCoins: 50, bonusCoins: 0, mainBalance: 50, bonusBalance: 0 };

export function pendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'topup-1',
    userId: 'u1',
    walletId: 'w1',
    amountVnd: 50000,
    coinsGranted: 50,
    rateVnd: 1000,
    status: TopUpStatus.PENDING,
    ...overrides,
  };
}

export function pendingPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    coinTopUpId: 'topup-1',
    provider: PaymentProvider.VNPAY,
    providerTxnId: 'VNPAY-ABC',
    amountVnd: 50000,
    status: PaymentStatus.PENDING,
    ...overrides,
  };
}

export function createTx() {
  return {
    payment: { create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    coinTopUp: { create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  };
}

export type MockTx = ReturnType<typeof createTx>;

export function createPrisma(tx: MockTx) {
  return {
    $transaction: jest.fn((work: (t: MockTx) => Promise<unknown>) => work(tx)),
    coinTopUp: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    payment: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    paymentCallback: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

export type MockPrisma = ReturnType<typeof createPrisma>;

export function createDeps() {
  return {
    coins: { spend: jest.fn(), credit: jest.fn() },
    wallets: { walletOf: jest.fn() },
    settings: { get: jest.fn() },
    notifications: { notify: jest.fn() },
  };
}

export type MockDeps = ReturnType<typeof createDeps>;

export function createService(prisma: MockPrisma, deps: MockDeps) {
  return new CoinTopUpService(
    prisma as unknown as PrismaService,
    deps.coins as unknown as CoinSpendService,
    deps.wallets as unknown as WalletService,
    deps.settings as unknown as PlatformSettingService,
    deps.notifications as unknown as NotificationService,
  );
}

/** Echoes `{ ...base, ...data }` like a Prisma write would. */
export function echoWith<T extends object>(base: T) {
  return ({ data }: { data: Record<string, unknown> }) => ({ ...base, ...data });
}

/** Awaits a promise expected to reject and returns the error (fails loudly if it resolves). */
export async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected promise to reject, but it resolved');
}
