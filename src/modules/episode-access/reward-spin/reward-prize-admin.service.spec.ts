import { RewardPrizeType } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PRIZE_REASON, RewardPrizeAdminService } from './reward-prize-admin.service';
import { WHEEL_REASON } from './wheel-total';

describe('RewardPrizeAdminService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    rewardPrize: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    rewardSpin: { count: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    rewardPrize: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const auditLog = { record: jest.fn(), recordMany: jest.fn() };
  const service = new RewardPrizeAdminService(
    prisma as unknown as PrismaService,
    auditLog as unknown as AuditLogService,
  );
  /** The weights of the other prizes switched on, as `otherActiveWeights` reads them. */
  const othersOn = (...weights: number[]) =>
    tx.rewardPrize.findMany.mockResolvedValue(weights.map((weight) => ({ weight })));
  const notOneHundred = { status: 409, response: { details: { reason: WHEEL_REASON.NOT_100 } } };

  const prize = {
    id: 'p1',
    code: 'bonus_50',
    name: '50 Coin',
    type: RewardPrizeType.BONUS_COIN,
    bonusCoins: 50,
    planDays: null,
    weight: 2500,
    isActive: true,
  };
  const create = (fields: object) =>
    service.create('admin-1', {
      code: 'plan_3',
      name: '3 ngày',
      type: RewardPrizeType.PLAN_DAYS,
      planDays: 3,
      weight: 2500,
      ...fields,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    tx.rewardPrize.findUnique.mockResolvedValue(null);
    tx.rewardPrize.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }));
    tx.rewardPrize.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }));
    othersOn(7500);
    tx.rewardSpin.count.mockResolvedValue(0);
  });

  it('adds a prize whose chance makes the wheel exactly 100 %, keeping only the amount its type uses', async () => {
    await create({ bonusCoins: 99 });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.rewardPrize.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PLAN_DAYS', bonusCoins: null, planDays: 3, weight: 2500, isActive: true }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_PRIZE_CREATED }),
      tx,
    );
  });

  it('refuses a new prize switched on that leaves the wheel short of or over 100 %, with the total', async () => {
    await expect(create({ weight: 2000 })).rejects.toMatchObject({
      ...notOneHundred,
      response: {
        message: 'The prizes switched on would add up to 95%, not 100%',
        details: { totalBasisPoints: 9500, missingBasisPoints: 500 },
      },
    });
    await expect(create({ weight: 3000 })).rejects.toMatchObject(notOneHundred);
    expect(tx.rewardPrize.create).not.toHaveBeenCalled();
  });

  it('adds a prize switched off whatever its chance, to switch it on later with a rebalance', async () => {
    await create({ weight: 1, isActive: false });
    expect(tx.rewardPrize.create).toHaveBeenCalledWith({ data: expect.objectContaining({ isActive: false }) });
  });

  it('refuses a taken code', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ id: 'p0' });
    await expect(create({})).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an amount the prize type does not use, and 404s an unknown prize', async () => {
    tx.rewardPrize.findUnique.mockResolvedValueOnce(prize);
    await expect(service.update('p1', 'admin-1', { planDays: 3 })).rejects.toMatchObject({
      response: { details: { reason: 'REWARD_PRIZE_AMOUNT_MISMATCH' } },
    });

    tx.rewardPrize.findUnique.mockResolvedValueOnce(null);
    await expect(service.update('p9', 'admin-1', { weight: 2 })).rejects.toMatchObject({ status: 404 });
  });

  it('renames a prize without checking the chances, and logs it', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);
    othersOn(1);

    await service.update('p1', 'admin-1', { name: '50 Coin thưởng' });

    expect(tx.rewardPrize.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: '50 Coin thưởng' } });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_PRIZE_UPDATED }),
      tx,
    );
  });

  it('refuses a chance or a switch that breaks 100 %, and takes one that keeps it', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);
    await expect(service.update('p1', 'admin-1', { weight: 3000 })).rejects.toMatchObject(notOneHundred);
    await expect(service.update('p1', 'admin-1', { isActive: false })).rejects.toMatchObject(notOneHundred);

    tx.rewardPrize.findUnique.mockResolvedValue({ ...prize, isActive: false });
    othersOn(10_000);
    await expect(service.update('p1', 'admin-1', { isActive: true })).rejects.toMatchObject(notOneHundred);
    othersOn(7500);
    await expect(service.update('p1', 'admin-1', { isActive: true })).resolves.toMatchObject({ isActive: true });
  });

  it('sets every chance in one save: listed prizes on, the rest off, one audit row each', async () => {
    tx.rewardPrize.findMany.mockResolvedValue([
      { id: 'a', isActive: true },
      { id: 'b', isActive: true },
      { id: 'c', isActive: false },
    ]);
    const body = {
      prizes: [
        { id: 'a', weight: 6000 },
        { id: 'c', weight: 4000 },
      ],
    };

    await service.setChances('admin-1', body);

    expect(tx.rewardPrize.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { weight: 6000, isActive: true } });
    expect(tx.rewardPrize.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { weight: 4000, isActive: true } });
    expect(tx.rewardPrize.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b'] } }, data: { isActive: false } });
    const [[rows]] = auditLog.recordMany.mock.calls as [{ entityId: string; payload: object }[]][];
    expect(rows.map((row) => [row.entityId, row.payload])).toEqual([
      ['a', { weight: 6000, isActive: true, rebalanced: true }],
      ['c', { weight: 4000, isActive: true, rebalanced: true }],
      ['b', { isActive: false, rebalanced: true }],
    ]);
    expect(prisma.rewardPrize.findMany).toHaveBeenCalled();
  });

  it('refuses a rebalance that is not 100 %, lists a prize twice or names an unknown one', async () => {
    tx.rewardPrize.findMany.mockResolvedValue([{ id: 'a', isActive: true }]);
    await expect(service.setChances('admin-1', { prizes: [{ id: 'a', weight: 9999 }] })).rejects.toMatchObject(
      notOneHundred,
    );
    await expect(
      service.setChances('admin-1', {
        prizes: [
          { id: 'a', weight: 5000 },
          { id: 'a', weight: 5000 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, response: { details: { reason: PRIZE_REASON.LISTED_TWICE } } });
    await expect(service.setChances('admin-1', { prizes: [{ id: 'z', weight: 10_000 }] })).rejects.toMatchObject({
      status: 404,
    });
    expect(tx.rewardPrize.update).not.toHaveBeenCalled();
  });

  it('deletes a switched-off prize for good and logs what it was', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ ...prize, isActive: false });
    tx.rewardSpin.count.mockResolvedValue(5);

    await expect(service.remove('p1', 'admin-1')).resolves.toEqual({ id: 'p1', deleted: true });

    expect(tx.rewardPrize.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(tx.rewardPrize.update).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.REWARD_PRIZE_REMOVED,
        payload: expect.objectContaining({ code: 'bonus_50', name: '50 Coin', bonusCoins: 50, wasActive: false }),
      }),
      tx,
    );
  });

  it('asks to switch an active prize off first while other prizes are on', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue(prize);
    await expect(service.remove('p1', 'admin-1')).rejects.toMatchObject(notOneHundred);
    expect(tx.rewardPrize.delete).not.toHaveBeenCalled();
  });

  it('404s a prize that is already gone', async () => {
    await expect(service.remove('p9', 'admin-1')).rejects.toMatchObject({ status: 404 });
    expect(tx.rewardPrize.delete).not.toHaveBeenCalled();
  });

  it('will not delete or switch off the last active prize while members hold spins', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ ...prize, weight: 10_000 });
    othersOn();
    tx.rewardSpin.count.mockResolvedValue(3);

    await expect(service.remove('p1', 'admin-1')).rejects.toMatchObject({
      status: 409,
      response: { details: { reason: PRIZE_REASON.LAST_ACTIVE, waitingSpins: 3 } },
    });
    await expect(service.update('p1', 'admin-1', { isActive: false })).rejects.toMatchObject({ status: 409 });
    expect(tx.rewardPrize.delete).not.toHaveBeenCalled();
    expect(tx.rewardPrize.update).not.toHaveBeenCalled();
  });

  it('may empty the wheel when no member is waiting to spin', async () => {
    tx.rewardPrize.findUnique.mockResolvedValue({ ...prize, weight: 10_000 });
    othersOn();
    await expect(service.remove('p1', 'admin-1')).resolves.toMatchObject({ deleted: true });
  });
});
