import { ConflictException } from '@nestjs/common';
import { RewardPrizeType, RewardSpinStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import type { PlanDaysGrantService } from '../subscription/plan-days-grant.service';
import { drawPrize, RewardSpinService, SPIN_REASON } from './reward-spin.service';

describe('drawPrize', () => {
  const prizes = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 3 },
  ];

  it('maps each ticket to the prize whose weight band holds it', () => {
    expect(drawPrize(prizes, () => 0).id).toBe('a');
    expect(drawPrize(prizes, () => 1).id).toBe('b');
    expect(drawPrize(prizes, () => 3).id).toBe('b');
  });

  it('draws from the total weight', () => {
    const pick = jest.fn(() => 0);
    drawPrize(prizes, pick);
    expect(pick).toHaveBeenCalledWith(4);
  });
});

describe('RewardSpinService', () => {
  const bonusPrize = {
    id: 'p-bonus',
    code: 'bonus_50',
    name: '50 Coin thưởng',
    type: RewardPrizeType.BONUS_COIN,
    bonusCoins: 50,
    planDays: null,
    weight: 1,
  };
  const daysPrize = {
    ...bonusPrize,
    id: 'p-days',
    code: 'plan_3',
    name: '3 ngày',
    type: RewardPrizeType.PLAN_DAYS,
    bonusCoins: null,
    planDays: 3,
  };
  const available = { id: 'spin-1', userId: 'u1', status: RewardSpinStatus.AVAILABLE, grantedAt: new Date() };

  const tx = {
    rewardPrize: { findMany: jest.fn() },
    rewardSpin: { updateMany: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    rewardSpin: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    rewardPrize: { findMany: jest.fn() },
    subscription: { findUnique: jest.fn() },
  };
  const coins = { credit: jest.fn() };
  const wallets = { walletOf: jest.fn() };
  const planDays = { openPlan: jest.fn(), giftPlan: jest.fn(), grant: jest.fn() };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new RewardSpinService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    planDays as unknown as PlanDaysGrantService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.rewardSpin.findFirst.mockResolvedValue(available);
    prisma.rewardSpin.count.mockResolvedValue(0);
    tx.rewardPrize.findMany.mockResolvedValue([bonusPrize]);
    tx.rewardSpin.updateMany.mockResolvedValue({ count: 1 });
    tx.rewardSpin.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...available,
      status: RewardSpinStatus.USED,
      spunAt: new Date(),
      bonusCoins: null,
      planDays: null,
      subscriptionId: null,
      promoValueCoins: null,
      prize: data.planDays ? daysPrize : bonusPrize,
      ...data,
    }));
    wallets.walletOf.mockResolvedValue({ id: 'w1', mainBalance: 0, bonusBalance: 50 });
    coins.credit.mockResolvedValue({ transactionId: 'tx-1', mainCoins: 0, bonusCoins: 50 });
    planDays.openPlan.mockResolvedValue(null);
    planDays.giftPlan.mockResolvedValue({ planId: 'monthly', priceCoins: 900 });
  });

  it('pays a bonus-Coin prize into a new bonus lot', async () => {
    const result = await service.spin('u1', 'k1');

    expect(tx.rewardSpin.updateMany).toHaveBeenCalledWith({
      where: { id: 'spin-1', status: RewardSpinStatus.AVAILABLE },
      data: expect.objectContaining({ status: RewardSpinStatus.USED, prizeId: 'p-bonus', idempotencyKey: 'k1' }),
    });
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({
        entryType: 'REWARD_SPIN',
        bonusAmount: 50,
        lotSource: 'REWARD_SPIN',
        referenceId: 'spin-1',
      }),
      expect.any(Date),
    );
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.not.objectContaining({ mainAmount: expect.anything() }),
      expect.anything(),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_SPIN_USED }),
      tx,
    );
    expect(result).toMatchObject({ bonusCoins: 50, bonusBalance: 50, availableSpins: 0 });
  });

  it('gives plan days through the plan service and keeps their promotion value', async () => {
    tx.rewardPrize.findMany.mockResolvedValue([daysPrize]);
    planDays.grant.mockResolvedValue({
      subscriptionId: 'sub-1',
      extended: false,
      currentPeriodEnd: new Date(),
      promoValueCoins: 90,
    });

    await service.spin('u1');

    expect(planDays.grant).toHaveBeenCalledWith(tx, 'u1', 3, expect.any(Date));
    expect(tx.rewardSpin.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { planDays: 3, subscriptionId: 'sub-1', promoValueCoins: 90 } }),
    );
    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('leaves plan days off the wheel when no plan could be given', async () => {
    tx.rewardPrize.findMany.mockResolvedValue([daysPrize]);
    planDays.giftPlan.mockResolvedValue(null);

    await expect(service.spin('u1')).rejects.toMatchObject({ response: { details: { reason: SPIN_REASON.NO_PRIZE } } });
    expect(tx.rewardSpin.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the member has no spin left', async () => {
    prisma.rewardSpin.findFirst.mockResolvedValue(null);

    await expect(service.spin('u1')).rejects.toMatchObject({
      status: 422,
      response: { details: { reason: SPIN_REASON.NONE_AVAILABLE } },
    });
  });

  it('uses a spin once when two requests race for it', async () => {
    tx.rewardSpin.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.spin('u1')).rejects.toMatchObject({ status: 409 });
    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('answers a replayed key with the first result, paying nothing again', async () => {
    prisma.rewardSpin.findUnique.mockResolvedValue({
      ...available,
      status: RewardSpinStatus.USED,
      bonusCoins: 50,
      subscriptionId: null,
      prize: bonusPrize,
    });

    await expect(service.spin('u1', 'k1')).resolves.toMatchObject({ bonusCoins: 50 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a key another member already used instead of failing on the unique key', async () => {
    prisma.rewardSpin.findUnique.mockResolvedValue({ ...available, userId: 'u2', status: RewardSpinStatus.USED });

    await expect(service.spin('u1', 'k1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('shows the wheel without the prize weights', async () => {
    prisma.rewardSpin.count.mockResolvedValue(2);
    prisma.rewardPrize.findMany.mockResolvedValue([bonusPrize]);
    prisma.rewardSpin.findMany.mockResolvedValue([]);

    const wheel = await service.mine('u1');

    expect(wheel).toMatchObject({ availableSpins: 2, history: [] });
    expect(wheel.prizes[0]).not.toHaveProperty('weight');
  });
});
