import { SubscriptionStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { SubscriptionRenewalService } from './subscription-renewal.service';
import { SubscriptionRenewalSweep } from './subscription-renewal.sweep';

describe('SubscriptionRenewalSweep.renewDue', () => {
  const prisma = { subscription: { findMany: jest.fn() } };
  const renewals = { renew: jest.fn(), expire: jest.fn(), lapse: jest.fn() };
  const sweep = new SubscriptionRenewalSweep(
    prisma as unknown as PrismaService,
    renewals as unknown as SubscriptionRenewalService,
    {} as unknown as JobQueue,
    {} as unknown as AppConfig,
  );
  const now = new Date('2026-11-05T00:00:00.000Z');

  /** Answers each pass by the status and auto-renew it asks for. */
  const rows = (due: string[], pastDue: string[], stopped: string[]) =>
    prisma.subscription.findMany.mockImplementation(({ where }: { where: { status: string; autoRenew?: boolean } }) => {
      if (where.status === SubscriptionStatus.PAST_DUE) return pastDue.map((id) => ({ id }));
      return (where.autoRenew === false ? stopped : due).map((id) => ({ id }));
    });

  beforeEach(() => jest.clearAllMocks());

  it('renews due plans, retries past-due ones and ends stopped plans whose period is over', async () => {
    rows(['due'], ['retry-ok', 'grace-over'], ['stopped']);
    renewals.renew.mockImplementation((id: string) => ({ renewed: id === 'due' || id === 'retry-ok' }));
    renewals.expire.mockResolvedValue(true);
    renewals.lapse.mockResolvedValue(true);

    await expect(sweep.renewDue(now)).resolves.toEqual({ renewed: 2, expired: 2 });
    expect(renewals.expire).toHaveBeenCalledTimes(1);
    expect(renewals.expire).toHaveBeenCalledWith('grace-over', now);
    expect(renewals.lapse).toHaveBeenCalledWith('stopped', now);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: SubscriptionStatus.ACTIVE, autoRenew: false, currentPeriodEnd: { lte: now } },
      }),
    );
  });

  it('does nothing when no plan is due', async () => {
    rows([], [], []);

    await expect(sweep.renewDue(now)).resolves.toEqual({ renewed: 0, expired: 0 });
    expect(renewals.renew).not.toHaveBeenCalled();
  });
});
