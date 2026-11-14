import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { businessDay } from 'src/modules/episode-access/daily-reward/daily-reward.service';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { registerMember } from './support/members';

const DAY_MS = 86_400_000;

interface Wallet {
  mainBalance: number;
  bonusBalance: number;
}
interface CheckIn {
  streakDay: number;
  bonusGranted: number;
  spinGranted: boolean;
}
interface Spin {
  status: string;
  bonusCoins: number | null;
  planDays: number | null;
  planActiveUntil: string | null;
  availableSpins: number;
  prize: { id: string; type: string } | null;
}

/** Daily check-in pays bonus Coins only (BR-05); its milestone day earns a reward spin (BR-09). */
describe('Daily check-in and the reward wheel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: Actor;
  const stamp = Date.now().toString(36);

  /** A member whose streak stands at day 6, so the next check-in is the milestone. */
  async function memberOnDaySix(): Promise<Actor> {
    const member = await registerMember(app);
    const wallet = await prisma.coinWallet.findUniqueOrThrow({ where: { userId: member.id } });
    const today = businessDay();
    await prisma.dailyCheckIn.createMany({
      data: [6, 5, 4, 3, 2, 1].map((streakDay) => ({
        userId: member.id,
        walletId: wallet.id,
        checkInDate: new Date(today.getTime() - (7 - streakDay) * DAY_MS),
        streakDay,
        streakContinued: streakDay > 1,
        bonusGranted: 0,
      })),
    });
    return member;
  }

  /** Leaves exactly one active prize on the wheel, so the draw is known. */
  async function onlyPrize(body: object): Promise<Row> {
    await prisma.rewardPrize.updateMany({ data: { isActive: false } });
    return admin.post('/admin/reward-prizes', body, 201);
  }

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    admin = await signIn(app, 'admin@aicinema.com');
  });

  afterAll(async () => {
    await prisma.rewardPrize.updateMany({ where: { code: { startsWith: 'e2e_' } }, data: { isActive: false } });
    await prisma.rewardPrize.updateMany({ where: { code: { not: { startsWith: 'e2e_' } } }, data: { isActive: true } });
    await app.close();
  });

  it('seeds a seven-day ladder of bonus Coins with the spin on day 7, and validates edits', async () => {
    const ladder =
      await admin.get<{ streakDay: number; bonusCoins: number; grantsSpin: boolean; isActive: boolean }[]>(
        '/admin/reward-rules',
      );
    const active = ladder.filter((rule) => rule.isActive);
    expect(active.map((rule) => rule.streakDay)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(active.filter((rule) => rule.grantsSpin).map((rule) => rule.streakDay)).toEqual([7]);

    const day1 = (await admin.get<Row[]>('/admin/reward-rules')).find((rule) => rule.streakDay === 1)!;
    await admin.patch(`/admin/reward-rules/${day1.id}`, { coins: 10 }, 400);
    await admin.post(
      '/admin/reward-rules',
      { code: `e2e_${stamp}`, name: 'Trùng ngày 1', streakDay: 1, bonusCoins: 1 },
      409,
    );
    await admin.post(
      '/admin/reward-rules',
      { code: `e2e8_${stamp}`, name: 'Ngày 8', streakDay: 8, bonusCoins: 1 },
      400,
    );
  });

  it('pays day one in bonus Coins only, once per business day', async () => {
    const member = await registerMember(app);

    const first = await member.post<CheckIn>('/daily-rewards/check-in', {}, 201);
    expect(first).toMatchObject({ streakDay: 1, bonusGranted: 5, spinGranted: false });
    expect(await member.get<Wallet>('/wallet')).toMatchObject({ mainBalance: 0, bonusBalance: 5 });
    await member.post('/daily-rewards/check-in', {}, 422);
    await member.post('/rewards/spins', {}, 422);
  });

  it('grants a spin on the milestone day and pays a bonus-Coin prize once', async () => {
    await onlyPrize({
      code: `e2e_bonus_${stamp}`,
      name: '40 Coin thưởng',
      type: 'BONUS_COIN',
      bonusCoins: 40,
      weight: 1,
    });
    const member = await memberOnDaySix();

    const day7 = await member.post<CheckIn>('/daily-rewards/check-in', {}, 201);
    expect(day7).toMatchObject({ streakDay: 7, bonusGranted: 30, spinGranted: true });
    expect(await member.get<{ availableSpins: number }>('/daily-rewards/status')).toMatchObject({ availableSpins: 1 });
    const wheel = await member.get<{ availableSpins: number; prizes: Row[] }>('/rewards/spins');
    expect(wheel.availableSpins).toBe(1);
    expect(wheel.prizes[0]).not.toHaveProperty('weight');

    const spin = await member.post<Spin>('/rewards/spins', {}, 201);
    expect(spin).toMatchObject({ status: 'USED', bonusCoins: 40, availableSpins: 0, prize: { type: 'BONUS_COIN' } });
    expect(await member.get<Wallet>('/wallet')).toMatchObject({ mainBalance: 0, bonusBalance: 70 });
    await member.post('/rewards/spins', {}, 422);
  });

  it('gives monthly-plan days that do not auto-renew, and extends a running plan', async () => {
    const plan = await admin.post(
      '/admin/membership-plans',
      { code: `e2e_monthly_${stamp}`, name: 'Gói Tháng e2e', period: 'MONTHLY', durationDays: 30 },
      201,
    );
    await admin.post(`/admin/membership-plans/${plan.id}/prices`, { priceCoins: 300 }, 201);
    await onlyPrize({ code: `e2e_days_${stamp}`, name: '3 ngày gói Tháng', type: 'PLAN_DAYS', planDays: 3, weight: 1 });
    const member = await memberOnDaySix();
    await member.post('/daily-rewards/check-in', {}, 201);

    const spin = await member.post<Spin>('/rewards/spins', {}, 201);
    expect(spin).toMatchObject({ planDays: 3, prize: { type: 'PLAN_DAYS' } });
    const mine = await member.get<{ status: string; autoRenew: boolean; currentPeriodEnd: string }>(
      '/subscriptions/me',
    );
    expect(mine).toMatchObject({ status: 'ACTIVE', autoRenew: false });
    const days = (new Date(mine.currentPeriodEnd).getTime() - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThanOrEqual(3);
    const row = await prisma.rewardSpin.findFirstOrThrow({ where: { userId: member.id } });
    expect(row.promoValueCoins).toBe(30);

    // A second spin adds the days on top of the plan just given.
    const checkIn = await prisma.dailyCheckIn.findFirstOrThrow({ where: { userId: member.id, streakDay: 1 } });
    await prisma.rewardSpin.create({ data: { userId: member.id, checkInId: checkIn.id } });
    const again = await member.post<Spin>('/rewards/spins', {}, 201);
    expect(new Date(again.planActiveUntil!).getTime()).toBe(new Date(mine.currentPeriodEnd).getTime() + 3 * DAY_MS);

    await admin.patch(`/admin/membership-plans/${plan.id}`, { isActive: false });
  });

  it('only allows monthly paid plans to be created or reconfigured', async () => {
    await admin.post(
      '/admin/membership-plans',
      { code: `e2e_weekly_${stamp}`, name: 'Unsupported weekly plan', period: 'WEEKLY', durationDays: 7 },
      400,
    );

    const plan = await admin.post(
      '/admin/membership-plans',
      { code: `e2e_monthly_only_${stamp}`, name: 'Monthly only', period: 'MONTHLY', durationDays: 30 },
      201,
    );
    await admin.patch(`/admin/membership-plans/${plan.id}`, { period: 'YEARLY' }, 400);
    // A monthly cycle is one month long, and no plan streams on more devices than it registers.
    await admin.patch(`/admin/membership-plans/${plan.id}`, { durationDays: 365 }, 400);
    await admin.patch(
      `/admin/membership-plans/${plan.id}`,
      { features: { maxRegisteredDevices: 1, maxConcurrentStreams: 2 } },
      400,
    );
    await admin.patch(`/admin/membership-plans/${plan.id}`, { isActive: false });
  });
});
