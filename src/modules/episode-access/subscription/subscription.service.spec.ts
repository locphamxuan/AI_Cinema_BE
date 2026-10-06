import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SUB_REASON, SubscriptionService } from './subscription.service';

describe('SubscriptionService.subscribe', () => {
  const tx = {
    membershipPlan: { findUnique: jest.fn() },
    membershipPlanPrice: { findFirst: jest.fn() },
    subscription: { count: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const wallets = {
    walletOf: jest.fn().mockResolvedValue({ id: 'w1' }),
    affordability: jest
      .fn()
      .mockResolvedValue({ mainBalance: 10, bonusBalance: 120, enoughCoins: false, missingCoins: 770 }),
  };
  const settings = { get: jest.fn().mockResolvedValue({ subscriptionCancelWindowHours: 24 }) };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  const plan = { id: 'p1', code: 'MONTHLY', name: 'Monthly', durationDays: 30, isActive: true, isFree: false };
  const price = { id: 'price-1', priceCoins: 900 };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ subscriptionCancelWindowHours: 24 });
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    wallets.affordability.mockResolvedValue({
      mainBalance: 10,
      bonusBalance: 120,
      enoughCoins: false,
      missingCoins: 770,
    });
    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(price);
    tx.subscription.count.mockResolvedValue(0);
    tx.subscription.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'sub-1',
      ...data,
    }));
  });

  it('quotes a PENDING intent without moving any Coin (step 10)', async () => {
    const intent = await service.subscribe('u1', 'p1');

    expect(intent).toMatchObject({
      planId: 'p1',
      planCode: 'MONTHLY',
      status: SubscriptionStatus.PENDING,
      autoRenew: true,
      priceCoins: 900,
      mainBalance: 10,
      bonusBalance: 120,
      enoughCoins: false,
      missingCoins: 770,
    });
    expect(intent.cancelDeadline).toBeInstanceOf(Date);
    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', planId: 'p1', status: SubscriptionStatus.PENDING }),
    });
    expect(coins.spend).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses a second intent while a plan is still open', async () => {
    tx.subscription.count.mockResolvedValue(1);

    await expect(service.subscribe('u1', 'p1')).rejects.toMatchObject({
      response: {
        statusCode: 409,
        details: {
          reason: SUB_REASON.EXISTS,
        },
      },
    });

    expect(tx.subscription.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a plan that does not exist', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue(null);

    await expect(service.subscribe('u1', 'missing')).rejects.toMatchObject({
      response: {
        statusCode: 404,
        details: {
          reason: 'PLAN_NOT_FOUND',
        },
      },
    });
  });

  it('answers 422 for a hidden plan, a free plan, or a plan with no price', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue({
      ...plan,
      isActive: false,
    });

    await expect(service.subscribe('u1', 'p1')).rejects.toThrow(UnprocessableEntityException);

    tx.membershipPlan.findUnique.mockResolvedValue({
      ...plan,
      isFree: true,
    });

    await expect(service.subscribe('u1', 'p1')).rejects.toThrow(UnprocessableEntityException);

    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(null);

    await expect(service.subscribe('u1', 'p1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'PLAN_NOT_PRICED',
        },
      },
    });
  });
});

describe('SubscriptionService.activate', () => {
  const tx = {
    membershipPlan: { findUnique: jest.fn() },
    subscription: { update: jest.fn() },
    subscriptionCycle: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }), affordability: jest.fn() };
  const settings = { get: jest.fn().mockResolvedValue({ subscriptionCancelWindowHours: 24 }) };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  const intent = { id: 'sub-1', userId: 'u1', planId: 'p1', priceCoins: 900, status: SubscriptionStatus.PENDING };
  const plan = { id: 'p1', code: 'MONTHLY', name: 'Monthly', durationDays: 30, isActive: true };
  const movement = { transactionId: 'tx-1', mainCoins: 10, bonusCoins: 890, mainBalance: 0, bonusBalance: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ subscriptionCancelWindowHours: 24 });
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    prisma.subscription.findFirst.mockResolvedValue(intent);
    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    coins.spend.mockResolvedValue(movement);
    tx.subscription.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'sub-1',
      ...data,
    }));
    tx.subscriptionCycle.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'cycle-1',
      ...data,
    }));
  });

  it('takes the first cycle in Coins and starts the period (step 16)', async () => {
    const result = await service.activate('u1', 'sub-1', 'key-1');

    expect(coins.spend).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'PLAN_PAYMENT', amountCoins: 900, idempotencyKey: 'key-1' }),
    );
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
    });
    expect(tx.subscriptionCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cycleNumber: 1, status: 'PAID', priceCoins: 900, coinTransactionId: 'tx-1' }),
    });
    expect(result).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      priceCoins: 900,
      charged: { mainCoins: 10, bonusCoins: 890 },
      cycleNumber: 1,
      episodeAccessGranted: true,
    });
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/membership' }), tx);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUBSCRIPTION_ACTIVATED, entityType: 'Subscription' }),
      tx,
    );
  });

  it('refuses anything but a PENDING intent', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      ...intent,
      status: SubscriptionStatus.ACTIVE,
    });

    await expect(service.activate('u1', 'sub-1')).rejects.toMatchObject({
      response: {
        statusCode: 409,
        details: {
          reason: SUB_REASON.NOT_PENDING,
        },
      },
    });

    expect(coins.spend).not.toHaveBeenCalled();
  });

  it('answers 404 for somebody else’s subscription id', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(service.activate('u1', 'missing')).rejects.toMatchObject({
      response: {
        statusCode: 404,
        details: {
          reason: SUB_REASON.NOT_FOUND,
        },
      },
    });
  });

  it('answers 422 when the plan was hidden after the intent', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue({
      ...plan,
      isActive: false,
    });

    await expect(service.activate('u1', 'sub-1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: 'PLAN_NOT_ACTIVE',
        },
      },
    });

    expect(coins.spend).not.toHaveBeenCalled();
  });

  it('leaves the intent PENDING when the wallet is short', async () => {
    coins.spend.mockRejectedValue(
      new UnprocessableEntityException({ message: 'short', details: { reason: 'INSUFFICIENT_COINS' } }),
    );

    await expect(service.activate('u1', 'sub-1')).rejects.toThrow(UnprocessableEntityException);
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.subscriptionCycle.create).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService auto-renew toggles', () => {
  const tx = { subscription: { update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ subscriptionCancelWindowHours: 24 }) };
  const notifications = { notify: jest.fn() };
  const service = new SubscriptionService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    {} as unknown as AuditLogService,
  );

  const active = {
    id: 'sub-1',
    userId: 'u1',
    status: SubscriptionStatus.ACTIVE,
    autoRenew: true,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    nextRenewalAt: new Date(Date.now() + 30 * 86_400_000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ subscriptionCancelWindowHours: 24 });
    prisma.subscription.findFirst.mockResolvedValue(active);
    tx.subscription.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...active,
      ...data,
    }));
  });

  it('stops auto-renew inside the window and keeps access until the period ends', async () => {
    const result = await service.cancelAutoRenew('u1', 'sub-1');

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ autoRenew: false, nextRenewalAt: null }),
    });
    expect(result).toMatchObject({ id: 'sub-1', autoRenew: false, accessUntil: active.currentPeriodEnd });
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('refuses once the 24h window has closed, and the renewal still runs', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      ...active,
      nextRenewalAt: new Date(Date.now() + 60 * 60_000),
    });

    await expect(service.cancelAutoRenew('u1', 'sub-1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: SUB_REASON.WINDOW_CLOSED,
        },
      },
    });

    expect(tx.subscription.update).not.toHaveBeenCalled();
  });

  it('resumes auto-renew before the period ends', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ ...active, autoRenew: false, nextRenewalAt: null });

    const result = await service.resumeAutoRenew('u1', 'sub-1');

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ autoRenew: true, nextRenewalAt: active.currentPeriodEnd }),
    });
    expect(result).toMatchObject({ autoRenew: true });
  });

  it('resuming what already renews changes nothing', async () => {
    await expect(service.resumeAutoRenew('u1', 'sub-1')).resolves.toMatchObject({ autoRenew: true });
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService reads', () => {
  const prisma = {
    $transaction: jest.fn(),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const service = new SubscriptionService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    {} as unknown as NotificationService,
    {} as unknown as AuditLogService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('mine returns nothing when there is no open plan', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.mine('u1')).resolves.toBeNull();
  });

  it('mine maps the plan, the deadline alias and the last cycle', async () => {
    const deadline = new Date('2026-11-04T00:00:00.000Z');
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubscriptionStatus.ACTIVE,
      cancelWindowEndsAt: deadline,
      plan: { id: 'p1', code: 'MONTHLY', name: 'Monthly', period: 'MONTHLY', durationDays: 30, features: {} },
      cycles: [{ cycleNumber: 2 }],
    });

    await expect(service.mine('u1')).resolves.toMatchObject({
      cancelDeadline: deadline,
      plan: { code: 'MONTHLY' },
      lastCycle: { cycleNumber: 2 },
    });
  });

  it('cycles reads only the owner’s rows, oldest first', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', userId: 'u1' });
    prisma.subscriptionCycle.findMany.mockResolvedValue([{ cycleNumber: 1 }]);

    await service.cycles('u1', 'sub-1');
    expect(prisma.subscriptionCycle.findMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'sub-1' },
      orderBy: { cycleNumber: 'asc' },
    });
  });

  it('detail answers 404 for an unknown subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('SubscriptionService.cancelByAdmin', () => {
  const tx = { subscription: { update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  it('ends the plan now with an audit trail', async () => {
    tx.subscription.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'sub-1',
      userId: 'u1',
      ...data,
    }));

    const result = await service.cancelByAdmin('sub-1', 'admin-1', 'fraud');

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: SubscriptionStatus.CANCELLED, endReason: 'CANCELLED_BY_ADMIN' }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUBSCRIPTION_CANCELLED, actorId: 'admin-1' }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.anything(), tx);
    expect(result).toMatchObject({ status: SubscriptionStatus.CANCELLED });
  });
});
