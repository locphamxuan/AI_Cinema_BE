import { NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AccessDecisionService } from 'src/modules/episode-access/access-decision/access-decision.service';
import type { MembershipPlanService } from 'src/modules/episode-access/membership-plan/membership-plan.service';
import type { CatalogService } from 'src/modules/catalog/catalog.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportTools } from './support-tools.service';

const MEMBER_ID = 'member-1';

/** Plan §5.2 sensitive fields: no connected read may hand them to the model. */
const FORBIDDEN_KEYS = [
  'streamUrl',
  'providerTxnId',
  'providerPaymentId',
  'redirectUrl',
  'ipAddress',
  'userAgent',
  'idempotencyKey',
  'deviceKey',
  'password',
  'passwordHash',
  'updatedById',
];

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      collectKeys(entry, keys);
    }
  }
  return keys;
}

function expectNoSensitiveKeys(payload: unknown): void {
  const keys = collectKeys(payload);
  for (const banned of FORBIDDEN_KEYS) expect(keys.has(banned)).toBe(false);
}

function buildTools() {
  const prisma = {
    coinWallet: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    coinTopUp: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    coinTransaction: { findMany: jest.fn() },
    userDevice: { findMany: jest.fn() },
    streamingSession: { findMany: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const accessDecisions = { decide: jest.fn() };
  const plans = { listPublic: jest.fn() };
  const catalog = { listMovies: jest.fn(), episodes: jest.fn() };
  const tools = new SupportTools(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    accessDecisions as unknown as AccessDecisionService,
    plans as unknown as MembershipPlanService,
    catalog as unknown as CatalogService,
  );
  return { tools, prisma, settings, accessDecisions, plans, catalog };
}

describe('SupportTools — member scoping', () => {
  it('reads the wallet of the signed-in member only, ignoring any id in model arguments', async () => {
    const { tools, prisma } = buildTools();
    prisma.coinWallet.findUnique.mockResolvedValue({ mainBalance: 100, bonusBalance: 20, lots: [] });

    const result = await tools.execute('get_member_wallet', MEMBER_ID, { memberId: 'member-2', userId: 'member-2' });

    expect(prisma.coinWallet.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MEMBER_ID } }),
    );
    expect(result).toEqual({ ok: true, data: { mainBalance: 100, bonusBalance: 20, lots: [] } });
    expectNoSensitiveKeys(result);
  });

  it('keeps subscription, top-ups, payments and coin ledger scoped by member id', async () => {
    const { tools, prisma } = buildTools();
    prisma.subscription.findFirst.mockResolvedValue({ status: 'ACTIVE', plan: { code: 'MONTHLY' } });
    prisma.coinTopUp.findMany.mockResolvedValue([{ amountVnd: 50000 }]);
    prisma.payment.findMany.mockResolvedValue([{ provider: 'VNPAY' }]);
    prisma.coinTransaction.findMany.mockResolvedValue([{ entryType: 'TOPUP' }]);

    await tools.execute('get_member_subscription', MEMBER_ID, {});
    await tools.execute('get_recent_topups', MEMBER_ID, {});
    await tools.execute('get_recent_payments', MEMBER_ID, {});
    await tools.execute('get_recent_coin_transactions', MEMBER_ID, {});

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: MEMBER_ID, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      }),
    );
    expect(prisma.coinTopUp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: MEMBER_ID } }));
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: MEMBER_ID } }));
    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wallet: { userId: MEMBER_ID } } }),
    );
  });

  it('never takes memberId from model arguments for episode access either', async () => {
    const { tools, accessDecisions } = buildTools();
    accessDecisions.decide.mockResolvedValue({ accessGranted: true, source: 'PLAN' });

    const result = await tools.execute('get_episode_access', MEMBER_ID, { episodeId: 'ep-1', memberId: 'member-2' });

    expect(accessDecisions.decide).toHaveBeenCalledWith('ep-1', MEMBER_ID);
    expect(result.ok).toBe(true);
  });

  it('returns UNAVAILABLE instead of throwing when a read fails', async () => {
    const { tools, prisma } = buildTools();
    prisma.coinTopUp.findMany.mockRejectedValue(new Error('db down'));

    await expect(tools.execute('get_recent_topups', MEMBER_ID, {})).resolves.toEqual({
      ok: false,
      error: 'UNAVAILABLE',
    });
  });
});

describe('SupportTools — sensitive fields stay out', () => {
  it('recentPayments selects no provider transaction ids or redirect url', async () => {
    const { tools, prisma } = buildTools();
    prisma.payment.findMany.mockResolvedValue([{ provider: 'VNPAY', amountVnd: 50000, status: 'PAID' }]);

    const result = await tools.execute('get_recent_payments', MEMBER_ID, {});

    const call = prisma.payment.findMany.mock.calls[0] as [{ select: Record<string, unknown> }];
    const select = call[0].select;
    for (const banned of ['providerTxnId', 'providerPaymentId', 'redirectUrl'])
      expect(select).not.toHaveProperty(banned);
    expect(result.ok).toBe(true);
    expectNoSensitiveKeys(result);
  });

  it('devices selects no deviceKey bearer token', async () => {
    const { tools, prisma } = buildTools();
    prisma.userDevice.findMany.mockResolvedValue([{ name: 'iPhone 15', platform: 'IOS' }]);

    const result = await tools.execute('get_member_devices', MEMBER_ID, {});

    const call = prisma.userDevice.findMany.mock.calls[0] as [{ select: Record<string, unknown> }];
    const select = call[0].select;
    expect(select).not.toHaveProperty('deviceKey');
    expect(result.ok).toBe(true);
    expectNoSensitiveKeys(result);
  });

  it('streamingSessions selects no ip address, user agent or idempotency key', async () => {
    const { tools, prisma } = buildTools();
    prisma.streamingSession.findMany.mockResolvedValue([{ status: 'ENDED', endReason: 'COMPLETED' }]);

    const result = await tools.execute('get_recent_streaming_sessions', MEMBER_ID, {});

    const call = prisma.streamingSession.findMany.mock.calls[0] as [{ select: Record<string, unknown> }];
    const select = call[0].select;
    for (const banned of ['ipAddress', 'userAgent', 'idempotencyKey']) expect(select).not.toHaveProperty(banned);
    const episodeSelect = select.episode as Record<string, unknown>;
    expect(episodeSelect).not.toHaveProperty('streamUrl');
    expect(result.ok).toBe(true);
    expectNoSensitiveKeys(result);
  });

  it('episodeAccess strips the streamUrl that decide() adds on granted access', async () => {
    const { tools, accessDecisions } = buildTools();
    accessDecisions.decide.mockResolvedValue({
      episodeId: 'ep-1',
      accessGranted: true,
      source: 'PLAN',
      planCode: 'MONTHLY',
      streamUrl: 'https://cdn.example.com/master.m3u8',
    });

    const result = await tools.execute('get_episode_access', MEMBER_ID, { episodeId: 'ep-1' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty('streamUrl');
    expectNoSensitiveKeys(result);
  });

  it('episodeAccess answers NOT_FOUND for an invisible episode and for a missing episodeId', async () => {
    const { tools, accessDecisions } = buildTools();
    accessDecisions.decide.mockRejectedValue(new NotFoundException('Episode not found'));

    await expect(tools.execute('get_episode_access', MEMBER_ID, { episodeId: 'ep-missing' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    accessDecisions.decide.mockClear();
    await expect(tools.execute('get_episode_access', MEMBER_ID, {})).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(accessDecisions.decide).not.toHaveBeenCalled();
  });

  it('policySnapshot keeps the internal updater identity out', async () => {
    const { tools, settings } = buildTools();
    settings.get.mockResolvedValue({
      coinRateVnd: 1000,
      bonusCoinExpiryDays: 30,
      coinTopUpMinVnd: 10000,
      coinTopUpMaxVnd: 2000000,
      subscriptionCancelWindowHours: 24,
      freeStarterEpisodeCount: 2,
      refundOnRemoval: true,
      updatedById: 'admin-9',
      updatedAt: new Date('2026-11-09'),
    });

    const result = await tools.execute('get_platform_policy_snapshot', MEMBER_ID, {});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty('updatedById');
    expectNoSensitiveKeys(result);
  });

  it('planCatalog passes the public catalogue through and never queries membership_plan directly', async () => {
    const { tools, prisma, plans } = buildTools();
    const publicPlans = [{ code: 'FREE', name: 'Free', priceCoins: null }];
    plans.listPublic.mockResolvedValue(publicPlans);

    const result = await tools.execute('get_plan_catalog', MEMBER_ID, {});

    expect(plans.listPublic).toHaveBeenCalledTimes(1);
    expect(prisma).not.toHaveProperty('membershipPlan');
    expect(result).toEqual({ ok: true, data: publicPlans });
    expectNoSensitiveKeys(result);
  });

  it('searchCatalog whitelists movie and episode fields (no stream url, no media extras)', async () => {
    const { tools, catalog } = buildTools();
    catalog.listMovies.mockResolvedValue({
      data: [{ id: 'movie-1', title: 'Phim A', synopsis: '...', releaseYear: 2026 }],
    });
    catalog.episodes.mockResolvedValue([
      {
        id: 'ep-1',
        episodeNumber: 1,
        title: 'Tập 1',
        coinPrice: 10,
        isFreeStarter: true,
        availability: 'AVAILABLE',
        notice: null,
        durationSeconds: 3600,
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        streamUrl: 'https://cdn.example.com/master.m3u8',
      },
    ]);

    const result = await tools.execute('search_catalog', MEMBER_ID, { query: 'Phim A' });

    expect(catalog.listMovies).toHaveBeenCalledWith(expect.objectContaining({ search: 'Phim A', page: 1, limit: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Array<{ episodes: Array<Record<string, unknown>> }>;
      expect(Object.keys(data[0].episodes[0]).sort()).toEqual(
        ['availability', 'coinPrice', 'episodeNumber', 'id', 'isFreeStarter', 'notice', 'title'].sort(),
      );
    }
    expectNoSensitiveKeys(result);
  });
});
