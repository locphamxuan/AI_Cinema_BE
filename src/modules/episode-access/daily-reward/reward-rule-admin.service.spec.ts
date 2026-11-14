import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { RewardRuleAdminService } from './reward-rule-admin.service';

describe('RewardRuleAdminService', () => {
  const tx = { rewardRule: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    rewardRule: { findMany: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new RewardRuleAdminService(
    prisma as unknown as PrismaService,
    auditLog as unknown as AuditLogService,
  );

  const dto = { code: 'streak_day_7', name: 'Ngày thứ 7 trong chuỗi', streakDay: 7, bonusCoins: 15, grantsSpin: true };
  const stored = { id: 'rule-7', ...dto, isActive: true };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.rewardRule.findUnique.mockResolvedValue(null);
    tx.rewardRule.count.mockResolvedValue(0);
    tx.rewardRule.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'rule-7',
      ...data,
    }));
    tx.rewardRule.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
  });

  it('lists the ladder streak-day first', async () => {
    prisma.rewardRule.findMany.mockResolvedValue([stored]);
    await service.list();
    expect(prisma.rewardRule.findMany).toHaveBeenCalledWith({ orderBy: [{ streakDay: 'asc' }, { isActive: 'desc' }] });
  });

  it('adds a rung paying bonus Coins and logs who built it', async () => {
    const rule = await service.create('admin-1', dto);

    expect(rule).toMatchObject({ code: 'streak_day_7', createdById: 'admin-1', grantsSpin: true });
    expect(tx.rewardRule.create).toHaveBeenCalledWith({ data: { ...dto, createdById: 'admin-1' } });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.REWARD_RULE_CREATED,
        entityType: 'RewardRule',
        actorId: 'admin-1',
      }),
      tx,
    );
  });

  it('refuses a code that is already on the ladder', async () => {
    tx.rewardRule.findUnique.mockResolvedValue({ id: 'rule-7', code: 'streak_day_7' });

    await expect(service.create('admin-1', dto)).rejects.toMatchObject({
      response: { details: { reason: 'REWARD_RULE_CODE_TAKEN' } },
    });
    expect(tx.rewardRule.create).not.toHaveBeenCalled();
  });

  it('refuses a second active rung for the same streak day', async () => {
    tx.rewardRule.count.mockResolvedValue(1);

    await expect(service.create('admin-1', dto)).rejects.toMatchObject({
      response: { details: { reason: 'REWARD_RULE_DAY_TAKEN', streakDay: 7 } },
    });
    expect(tx.rewardRule.create).not.toHaveBeenCalled();
  });

  it('edits a rung, including switching a day off, and logs it', async () => {
    tx.rewardRule.findUnique.mockResolvedValue(stored);

    const rule = await service.update('rule-7', 'admin-1', { bonusCoins: 20, isActive: false });

    expect(tx.rewardRule.count).not.toHaveBeenCalled();
    expect(tx.rewardRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-7' },
      data: { bonusCoins: 20, isActive: false },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_RULE_UPDATED, actorId: 'admin-1' }),
      tx,
    );
    expect(rule).toMatchObject({ isActive: false });
  });

  it('checks the day again when a rung is switched back on, and 404s an unknown one', async () => {
    tx.rewardRule.findUnique.mockResolvedValueOnce({ ...stored, isActive: false });
    tx.rewardRule.count.mockResolvedValue(1);
    await expect(service.update('rule-7', 'admin-1', { isActive: true })).rejects.toMatchObject({
      response: { details: { reason: 'REWARD_RULE_DAY_TAKEN' } },
    });
    expect(tx.rewardRule.count).toHaveBeenCalledWith({
      where: { streakDay: 7, isActive: true, id: { not: 'rule-7' } },
    });

    tx.rewardRule.findUnique.mockResolvedValueOnce(null);
    await expect(service.update('nope', 'admin-1', { bonusCoins: 1 })).rejects.toMatchObject({ status: 404 });
  });
});
