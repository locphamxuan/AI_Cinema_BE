import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { RewardRuleAdminService } from './reward-rule-admin.service';

describe('RewardRuleAdminService', () => {
  const tx = { rewardRule: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    rewardRule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new RewardRuleAdminService(
    prisma as unknown as PrismaService,
    auditLog as unknown as AuditLogService,
  );

  const dto = { code: 'streak_day_7', name: 'Ngày thứ 7 trong chuỗi', streakDay: 7, coins: 10, bonusCoins: 5 };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.rewardRule.findUnique.mockResolvedValue(null);
    tx.rewardRule.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'rule-7',
      ...data,
    }));
    tx.rewardRule.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'rule-7',
      code: 'streak_day_7',
      streakDay: 7,
      coins: 10,
      bonusCoins: 5,
      isActive: true,
      ...data,
    }));
  });

  it('lists the ladder streak-day first', async () => {
    prisma.rewardRule.findMany.mockResolvedValue([dto]);
    await service.list();
    expect(prisma.rewardRule.findMany).toHaveBeenCalledWith({ orderBy: { streakDay: 'asc' } });
  });

  it('adds a rung and logs who built it', async () => {
    const rule = await service.create('admin-1', dto);

    expect(rule).toMatchObject({ code: 'streak_day_7', createdById: 'admin-1' });
    expect(tx.rewardRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ...dto, createdById: 'admin-1' }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.REWARD_RULE_CREATED,
        entityType: 'RewardRule',
        actorId: 'admin-1',
      }),
      tx,
    );
  });

  it('defaults a missing bonus to zero Coins', async () => {
    const { bonusCoins: _dropped, ...withoutBonus } = dto;
    await service.create('admin-1', withoutBonus);
    expect(tx.rewardRule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ bonusCoins: 0 }) });
  });

  it('refuses a code that is already on the ladder', async () => {
    tx.rewardRule.findUnique.mockResolvedValue({
      id: 'rule-7',
      code: 'streak_day_7',
    });

    await expect(service.create('admin-1', dto)).rejects.toMatchObject({
      response: {
        details: {
          reason: 'REWARD_RULE_CODE_TAKEN',
        },
      },
    });

    expect(tx.rewardRule.create).not.toHaveBeenCalled();
  });

  it('edits a rung, including switching a day off, and logs it', async () => {
    const rule = await service.update('rule-7', 'admin-1', { coins: 20, isActive: false });

    expect(tx.rewardRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-7' },
      data: expect.objectContaining({ coins: 20, isActive: false }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.REWARD_RULE_UPDATED, actorId: 'admin-1' }),
      tx,
    );
    expect(rule).toMatchObject({ isActive: false });
  });
});
