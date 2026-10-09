import { SubscriptionStatus } from '@prisma/client';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SubscriptionRenewalService } from './subscription-renewal.service';

describe('SubscriptionRenewalService.renew', () => {
  const tx = {
    subscription: { findUnique: jest.fn(), update: jest.fn() },
    membershipPlan: { findUnique: jest.fn() },
    membershipPlanPrice: { findFirst: jest.fn() },
    subscriptionCycle: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const settings = {
    get: jest.fn().mockResolvedValue({ subscriptionCancelWindowHours: 24, planRenewalGraceHours: 48 }),
  };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionRenewalService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  const subscription = {
    id: 'sub-1',
    userId: 'u1',
    planId: 'p1',
    status: SubscriptionStatus.ACTIVE,
    autoRenew: true,
    priceCoins: 900,
    renewalsCompleted: 0,
    currentPeriodEnd: new Date('2026-11-05T00:00:00.000Z'),
  };
  const plan = { id: 'p1', code: 'MONTHLY', name: 'Monthly', durationDays: 30, isActive: true };
  const movement = { transactionId: 'tx-2', mainCoins: 900, bonusCoins: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ subscriptionCancelWindowHours: 24, planRenewalGraceHours: 48 });
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    tx.subscription.findUnique.mockResolvedValue(subscription);
    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue({ priceCoins: 850 });
    coins.spend.mockResolvedValue(movement);
    tx.subscription.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...subscription,
      ...data,
    }));
  });

  it('charges the price in force and pushes the period (step 19)', async () => {
    const outcome = await service.renew('sub-1');

    expect(coins.spend).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({
        entryType: 'PLAN_RENEWAL',
        amountCoins: 850,
        idempotencyKey: 'sub:sub-1:cycle:2',
      }),
      expect.any(Date),
    );
    expect(tx.subscriptionCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cycleNumber: 2, status: 'PAID', priceCoins: 850 }),
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE, priceCoins: 850, renewalsCompleted: 1 }),
    });
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/membership' }), tx);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUBSCRIPTION_RENEWED }),
      tx,
    );
    expect(outcome).toEqual({ renewed: true, expired: false, cycleNumber: 2 });
  });

  it('falls back to the snapshot price when no price row is in force', async () => {
    tx.membershipPlanPrice.findFirst.mockResolvedValue(null);

    await service.renew('sub-1');

    expect(coins.spend).toHaveBeenCalledWith(tx, 'w1', expect.objectContaining({ amountCoins: 900 }), expect.any(Date));
  });

  it.each([
    ['missing row', null],
    ['cancelled plan', { ...subscription, status: SubscriptionStatus.CANCELLED }],
    ['auto-renew off', { ...subscription, autoRenew: false }],
  ])('leaves %s alone', async (_label, row) => {
    tx.subscription.findUnique.mockResolvedValue(row);

    await expect(service.renew('sub-1')).resolves.toEqual({ renewed: false, expired: false, cycleNumber: null });
    expect(coins.spend).not.toHaveBeenCalled();
  });

  it('leaves a plan whose catalogue entry went away alone', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue(null);

    await expect(service.renew('sub-1')).resolves.toEqual({ renewed: false, expired: false, cycleNumber: null });
    expect(coins.spend).not.toHaveBeenCalled();
  });

  it('writes a FAILED cycle and parks the plan in PAST_DUE when the wallet is short', async () => {
    coins.spend.mockRejectedValue(new Error('short of Coins'));

    const outcome = await service.renew('sub-1');

    expect(tx.subscriptionCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cycleNumber: 2, status: 'FAILED' }),
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
    });
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
    expect(outcome).toEqual({ renewed: false, expired: false, cycleNumber: 2 });
  });
});

describe('SubscriptionRenewalService.expire', () => {
  const tx = {
    subscription: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionRenewalService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  const pastDue = {
    id: 'sub-1',
    userId: 'u1',
    status: SubscriptionStatus.PAST_DUE,
    renewalsCompleted: 3,
    currentPeriodEnd: new Date('2026-11-05T00:00:00.000Z'),
    nextRenewalAt: new Date(Date.now() - 60_000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.subscription.findUnique.mockResolvedValue(pastDue);
    tx.subscription.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...pastDue,
      ...data,
    }));
  });

  it('ends the plan once the grace period has run out', async () => {
    await expect(service.expire('sub-1')).resolves.toBe(true);

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({ status: SubscriptionStatus.EXPIRED, endReason: 'PAYMENT_FAILED' }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUBSCRIPTION_EXPIRED }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('keeps waiting while the retry moment is still ahead', async () => {
    tx.subscription.findUnique.mockResolvedValue({ ...pastDue, nextRenewalAt: new Date(Date.now() + 3_600_000) });

    await expect(service.expire('sub-1')).resolves.toBe(false);
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });

  it('touches nothing that is not past due', async () => {
    tx.subscription.findUnique.mockResolvedValue({ ...pastDue, status: SubscriptionStatus.ACTIVE });

    await expect(service.expire('sub-1')).resolves.toBe(false);
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });
});
