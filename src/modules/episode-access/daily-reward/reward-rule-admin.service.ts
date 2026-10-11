import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { CreateRewardRuleRequestDto } from './dto/create-reward-rule.request.dto';
import { UpdateRewardRuleRequestDto } from './dto/update-reward-rule.request.dto';

/** The Admin's streak ladder: one active rung per streak day, each paying bonus Coins. */
@Injectable()
export class RewardRuleAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  list() {
    return this.prisma.rewardRule.findMany({ orderBy: [{ streakDay: 'asc' }, { isActive: 'desc' }] });
  }

  async create(actorId: string, dto: CreateRewardRuleRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.rewardRule.findUnique({ where: { code: dto.code } })) {
        throw new ConflictException({
          message: `The rule "${dto.code}" already exists`,
          details: { reason: 'REWARD_RULE_CODE_TAKEN' },
        });
      }
      await assertDayFree(tx, dto.streakDay);
      const rule = await tx.rewardRule.create({ data: { ...dto, createdById: actorId } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.REWARD_RULE_CREATED,
          entityType: 'RewardRule',
          entityId: rule.id,
          movieId: null,
          actorId,
          payload: {
            code: rule.code,
            streakDay: rule.streakDay,
            bonusCoins: rule.bonusCoins,
            grantsSpin: rule.grantsSpin,
          },
        },
        tx,
      );
      return rule;
    });
  }

  async update(id: string, actorId: string, dto: UpdateRewardRuleRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.rewardRule.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException({ message: 'Reward rule not found', details: { reason: 'REWARD_RULE_NOT_FOUND' } });
      }
      const active = dto.isActive ?? current.isActive;
      const streakDay = dto.streakDay ?? current.streakDay;
      if (active) await assertDayFree(tx, streakDay, id);
      const rule = await tx.rewardRule.update({ where: { id }, data: dto });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.REWARD_RULE_UPDATED,
          entityType: 'RewardRule',
          entityId: rule.id,
          movieId: null,
          actorId,
          payload: {
            code: rule.code,
            isActive: rule.isActive,
            streakDay: rule.streakDay,
            bonusCoins: rule.bonusCoins,
            grantsSpin: rule.grantsSpin,
          },
        },
        tx,
      );
      return rule;
    });
  }
}

/** One active rung per streak day, so a check-in never has two rewards to choose from. */
async function assertDayFree(tx: PrismaTx, streakDay: number, exceptId?: string) {
  const taken = await tx.rewardRule.count({
    where: { streakDay, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (taken) {
    throw new ConflictException({
      message: `Streak day ${streakDay} already has an active rule`,
      details: { reason: 'REWARD_RULE_DAY_TAKEN', streakDay },
    });
  }
}
