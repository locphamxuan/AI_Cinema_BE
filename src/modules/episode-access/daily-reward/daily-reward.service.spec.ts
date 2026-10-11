import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { businessDay, CHECKIN_REASON, DailyRewardService } from './daily-reward.service';

describe('businessDay', () => {
  it('counts the day in Vietnam, not in UTC', () => {
    // 23:00 in Vietnam on Oct 5 is still Oct 5 there.
    expect(businessDay(new Date('2026-10-05T16:00:00.000Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    // One hour later UTC it is already Oct 6 in Vietnam.
    expect(businessDay(new Date('2026-10-05T17:00:00.000Z')).toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
});

describe('DailyRewardService.status', () => {
  const prisma = {
    dailyCheckIn: { findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
    rewardRule: { findMany: jest.fn(), findFirst: jest.fn() },
    coinLot: { findMany: jest.fn() },
    rewardSpin: { count: jest.fn() },
  };
  const wallets = { walletOf: jest.fn() };
  const service = new DailyRewardService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    wallets as unknown as WalletService,
  );

  const wallet = { id: 'w1', mainBalance: 10, bonusBalance: 130 };
  const ladder = [
    { streakDay: 1, bonusCoins: 3, grantsSpin: false },
    { streakDay: 2, bonusCoins: 4, grantsSpin: false },
    { streakDay: 7, bonusCoins: 30, grantsSpin: true },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue(wallet);
    prisma.rewardRule.findMany.mockResolvedValue(ladder);
    prisma.coinLot.findMany.mockResolvedValue([]);
    prisma.rewardSpin.count.mockResolvedValue(1);
  });

  it('reports today as claimed with the streak it paid', async () => {
    const today = businessDay();
    prisma.dailyCheckIn.findUnique.mockResolvedValue({ streakDay: 3 });
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      checkInDate: new Date(today.getTime() - 86_400_000),
      streakDay: 2,
    });

    const status = await service.status('u1');

    expect(status).toMatchObject({ checkedInToday: true, streakDay: 3, mainBalance: 10, bonusBalance: 130 });
    expect(status.streakContinued).toBe(false);
    expect(status.ladder).toHaveLength(3);
    expect(status.ladder[2]).toEqual({ streakDay: 7, bonusCoins: 30, grantsSpin: true });
    expect(status.availableSpins).toBe(1);
  });

  it('starts a fresh streak after a gap', async () => {
    const today = businessDay();
    prisma.dailyCheckIn.findUnique.mockResolvedValue(null);
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      checkInDate: new Date(today.getTime() - 3 * 86_400_000),
      streakDay: 5,
    });

    const status = await service.status('u1');

    expect(status).toMatchObject({ checkedInToday: false, streakDay: 0 });
    expect(status.reward).toEqual({ streakDay: 1, bonusCoins: 3, grantsSpin: false });
  });
});

describe('DailyRewardService.checkIn', () => {
  const tx = { dailyCheckIn: { create: jest.fn() }, rewardSpin: { create: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    dailyCheckIn: { findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
    rewardRule: { findMany: jest.fn(), findFirst: jest.fn() },
    coinLot: { findMany: jest.fn() },
  };
  const coins = { credit: jest.fn(), spend: jest.fn() };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const service = new DailyRewardService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
  );

  const rule = { id: 'rule-3', streakDay: 3, bonusCoins: 7, grantsSpin: false, isActive: true };
  const movement = { transactionId: 'tx-3', mainCoins: 0, bonusCoins: 7, mainBalance: 10, bonusBalance: 137 };

  beforeEach(() => {
    jest.clearAllMocks();
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    prisma.dailyCheckIn.findUnique.mockResolvedValue(null);
    prisma.rewardRule.findFirst.mockResolvedValue(rule);
    coins.credit.mockResolvedValue(movement);
    tx.dailyCheckIn.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'ci-1',
      ...data,
    }));
    prisma.dailyCheckIn.count.mockResolvedValue(0);
  });

  it('continues yesterday’s streak and pays the ladder in bonus Coins only (step 12, BR-05)', async () => {
    const today = businessDay();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      checkInDate: new Date(today.getTime() - 86_400_000),
      streakDay: 2,
    });

    const result = await service.checkIn('u1', 'key-1');

    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({
        entryType: 'DAILY_REWARD',
        bonusAmount: 7,
        idempotencyKey: 'key-1',
      }),
      today,
    );
    expect(tx.dailyCheckIn.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        streakDay: 3,
        streakContinued: true,
        bonusGranted: 7,
        coinTransactionId: 'tx-3',
        ruleId: 'rule-3',
      }),
    });
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.not.objectContaining({ mainAmount: expect.anything() }),
      expect.anything(),
    );
    expect(result).toMatchObject({ streakDay: 3, streakContinued: true, bonusGranted: 7, spinGranted: false });
    expect(tx.rewardSpin.create).not.toHaveBeenCalled();
  });

  it('grants a reward spin on the milestone day (BR-09)', async () => {
    const today = businessDay();
    prisma.dailyCheckIn.findFirst.mockResolvedValue({
      checkInDate: new Date(today.getTime() - 86_400_000),
      streakDay: 6,
    });
    prisma.rewardRule.findFirst.mockResolvedValue({ ...rule, streakDay: 7, bonusCoins: 30, grantsSpin: true });

    const result = await service.checkIn('u1');

    expect(result).toMatchObject({ streakDay: 7, spinGranted: true });
    expect(tx.rewardSpin.create).toHaveBeenCalledWith({ data: { userId: 'u1', checkInId: 'ci-1' } });
  });

  it('starts at day one after a gap', async () => {
    prisma.dailyCheckIn.findFirst.mockResolvedValue(null);
    prisma.rewardRule.findFirst.mockResolvedValue({ ...rule, streakDay: 1, bonusCoins: 3 });

    const result = await service.checkIn('u1');

    expect(result).toMatchObject({ streakDay: 1, streakContinued: false });
    expect(tx.dailyCheckIn.create).toHaveBeenCalledWith({ data: expect.objectContaining({ streakDay: 1 }) });
  });

  it('refuses a second claim on the same business day', async () => {
    prisma.dailyCheckIn.findUnique.mockResolvedValue({
      streakDay: 3,
    });

    await expect(service.checkIn('u1')).rejects.toMatchObject({
      status: 422,
      response: {
        details: {
          reason: CHECKIN_REASON.ALREADY_TODAY,
        },
      },
    });

    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('pays nothing when the ladder has no rule for today', async () => {
    prisma.dailyCheckIn.findFirst.mockResolvedValue(null);
    prisma.rewardRule.findFirst.mockResolvedValue(null);

    await expect(service.checkIn('u1')).rejects.toMatchObject({
      status: 422,
      response: {
        details: {
          reason: 'NO_REWARD_TODAY',
        },
      },
    });

    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('turns a lost race into the same already-checked-in answer', async () => {
    prisma.dailyCheckIn.findFirst.mockResolvedValue(null);
    tx.dailyCheckIn.create.mockRejectedValue(new Error('Unique constraint failed'));
    prisma.dailyCheckIn.count.mockResolvedValue(1);

    await expect(service.checkIn('u1')).rejects.toMatchObject({
      status: 422,
      response: {
        details: {
          reason: CHECKIN_REASON.ALREADY_TODAY,
        },
      },
    });
  });

  it('rethrows when the failure was not a double claim', async () => {
    prisma.dailyCheckIn.findFirst.mockResolvedValue(null);
    tx.dailyCheckIn.create.mockRejectedValue(new Error('DB is down'));
    prisma.dailyCheckIn.count.mockResolvedValue(0);

    await expect(service.checkIn('u1')).rejects.toThrow('DB is down');
  });
});
