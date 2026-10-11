import { SubscriptionStatus } from '@prisma/client';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { PlanDaysGrantService } from './plan-days-grant.service';

const DAY_MS = 86_400_000;

describe('PlanDaysGrantService.grant (BR-09)', () => {
  const tx = {
    subscription: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    membershipPlanPrice: { findFirst: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ subscriptionCancelWindowHours: 24 }) };
  const service = new PlanDaysGrantService(settings as unknown as PlatformSettingService);
  const now = new Date('2026-10-11T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ subscriptionCancelWindowHours: 24 });
    tx.subscription.update.mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id }));
    tx.subscription.create.mockImplementation(() => ({ id: 'sub-new' }));
    tx.membershipPlanPrice.findFirst.mockResolvedValue({ planId: 'monthly', priceCoins: 900 });
  });

  it('adds the days to a running plan and moves its renewal with it', async () => {
    const end = new Date(now.getTime() + 10 * DAY_MS);
    tx.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      autoRenew: true,
      currentPeriodEnd: end,
      priceCoins: 900,
    });

    const granted = await service.grant(tx as never, 'u1', 3, now);

    const newEnd = new Date(end.getTime() + 3 * DAY_MS);
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: newEnd,
        nextRenewalAt: newEnd,
        cancelWindowEndsAt: new Date(newEnd.getTime() - 24 * 3_600_000),
      }),
    });
    expect(granted).toEqual({ subscriptionId: 'sub-1', extended: true, currentPeriodEnd: newEnd, promoValueCoins: 90 });
  });

  it('counts the days from now for a plan waiting on a failed renewal', async () => {
    tx.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      autoRenew: true,
      currentPeriodEnd: new Date(now.getTime() - DAY_MS),
      priceCoins: 900,
    });

    const granted = await service.grant(tx as never, 'u1', 1, now);

    expect(granted?.currentPeriodEnd).toEqual(new Date(now.getTime() + DAY_MS));
  });

  it('starts a monthly plan of that many days, without auto-renew, for a member without one', async () => {
    tx.subscription.findFirst.mockResolvedValue(null);

    const granted = await service.grant(tx as never, 'u1', 3, now);

    expect(tx.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: SubscriptionStatus.PENDING } }),
    );
    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        planId: 'monthly',
        status: SubscriptionStatus.ACTIVE,
        source: 'REWARD',
        autoRenew: false,
        nextRenewalAt: null,
        currentPeriodEnd: new Date(now.getTime() + 3 * DAY_MS),
      }),
    });
    expect(granted).toMatchObject({ subscriptionId: 'sub-new', extended: false, promoValueCoins: 90 });
  });

  it('gives nothing when no monthly plan is on sale', async () => {
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(null);

    await expect(service.grant(tx as never, 'u1', 3, now)).resolves.toBeNull();
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });
});
