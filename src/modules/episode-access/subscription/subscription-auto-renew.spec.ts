import { SubscriptionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { SUB_REASON, SubscriptionService } from './subscription.service';

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
      status: 422,
      response: {
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

  it('stopping what is already stopped answers the same state without a second notice', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ ...active, autoRenew: false, nextRenewalAt: null });

    await expect(service.cancelAutoRenew('u1', 'sub-1')).resolves.toMatchObject({ autoRenew: false });
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it.each([SubscriptionStatus.PENDING, SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED])(
    'refuses to toggle the renewal of a %s plan',
    async (status) => {
      prisma.subscription.findFirst.mockResolvedValue({ ...active, status, autoRenew: false });

      for (const toggle of [
        () => service.cancelAutoRenew('u1', 'sub-1'),
        () => service.resumeAutoRenew('u1', 'sub-1'),
      ]) {
        await expect(toggle()).rejects.toMatchObject({
          status: 409,
          response: { details: { reason: SUB_REASON.NOT_ACTIVE } },
        });
      }
      expect(tx.subscription.update).not.toHaveBeenCalled();
    },
  );

  it('refuses to resume once the paid period is over', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      ...active,
      status: SubscriptionStatus.PAST_DUE,
      autoRenew: false,
      currentPeriodEnd: new Date(Date.now() - 60_000),
    });

    await expect(service.resumeAutoRenew('u1', 'sub-1')).rejects.toMatchObject({
      status: 409,
      response: { details: { reason: SUB_REASON.ENDED } },
    });
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });
});
