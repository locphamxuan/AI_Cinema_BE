import { RewardPrizeType } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PRIZE_REASON, RewardPrizeAdminService } from './reward-prize-admin.service';

describe('RewardPrizeAdminService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    rewardPrize: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    rewardSpin: { count: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)) };
  const auditLog = { record: jest.fn() };
  const service = new RewardPrizeAdminService(
    prisma as unknown as PrismaService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.rewardPrize.findUnique.mockResolvedValue(null);
    tx.rewardPrize.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }));
    tx.rewardPrize.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }));
    tx.rewardPrize.count.mockResolvedValue(1);
    tx.rewardSpin.count.mockResolvedValue(0);
  });

  it('keeps only the amount the prize type uses', async () => {
    await service.create('admin-1', {
      code: 'plan_3',
      name: '3 ngày',
      type: RewardPrizeType.PLAN_DAYS,
      bonusCoins: 99,
      planDays: 3,
      weight: 5,
    });

    expect(tx.rewardPrize.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PLAN_DAYS', bonusCoins: null, planDays: 3, createdById: 'admin-1' }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_PRIZE_CREATED }),
      tx,
    );
  });

  it('refuses a taken code', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ id: 'p0' });

    await expect(
      service.create('admin-1', {
        code: 'bonus_50',
        name: 'x',
        type: RewardPrizeType.BONUS_COIN,
        bonusCoins: 50,
        weight: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an amount the prize type does not use, and 404s an unknown prize', async () => {
    tx.rewardPrize.findUnique.mockResolvedValueOnce({ id: 'p1', type: RewardPrizeType.BONUS_COIN });
    await expect(service.update('p1', 'admin-1', { planDays: 3 })).rejects.toMatchObject({
      response: { details: { reason: 'REWARD_PRIZE_AMOUNT_MISMATCH' } },
    });

    tx.rewardPrize.findUnique.mockResolvedValueOnce(null);
    await expect(service.update('p9', 'admin-1', { weight: 2 })).rejects.toMatchObject({ status: 404 });
  });

  it('edits the weight or takes the prize off the wheel, and logs it', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ id: 'p1', type: RewardPrizeType.BONUS_COIN, isActive: true });

    await service.update('p1', 'admin-1', { weight: 9, isActive: false });

    expect(tx.rewardPrize.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { weight: 9, isActive: false } });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_PRIZE_UPDATED }),
      tx,
    );
  });

  const prize = {
    id: 'p1',
    code: 'bonus_50',
    name: '50 Coin',
    type: RewardPrizeType.BONUS_COIN,
    bonusCoins: 50,
    planDays: null,
    weight: 10,
    isActive: true,
  };

  it('deletes a prize for good and logs what it was', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);

    await expect(service.remove('p1', 'admin-1')).resolves.toEqual({ id: 'p1', deleted: true });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.rewardPrize.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(tx.rewardPrize.update).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.REWARD_PRIZE_REMOVED,
        payload: expect.objectContaining({ code: 'bonus_50', name: '50 Coin', bonusCoins: 50, wasActive: true }),
      }),
      tx,
    );
  });

  it('404s a prize that is already gone', async () => {
    await expect(service.remove('p9', 'admin-1')).rejects.toMatchObject({ status: 404 });
    expect(tx.rewardPrize.delete).not.toHaveBeenCalled();
  });

  it('will not delete or switch off the last active prize while members hold spins', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);
    tx.rewardPrize.count.mockResolvedValue(0);
    tx.rewardSpin.count.mockResolvedValue(3);

    await expect(service.remove('p1', 'admin-1')).rejects.toMatchObject({
      status: 409,
      response: { details: { reason: PRIZE_REASON.LAST_ACTIVE, waitingSpins: 3 } },
    });
    await expect(service.update('p1', 'admin-1', { isActive: false })).rejects.toMatchObject({ status: 409 });
    expect(tx.rewardPrize.delete).not.toHaveBeenCalled();
    expect(tx.rewardPrize.update).not.toHaveBeenCalled();
  });

  it('may empty the wheel when no member is waiting to spin, and always delete a switched-off prize', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);
    tx.rewardPrize.count.mockResolvedValue(0);
    await expect(service.remove('p1', 'admin-1')).resolves.toMatchObject({ deleted: true });

    tx.rewardSpin.count.mockResolvedValue(5);
    tx.rewardPrize.findUnique.mockResolvedValue({ ...prize, isActive: false });
    await expect(service.remove('p1', 'admin-1')).resolves.toMatchObject({ deleted: true });
  });
});
