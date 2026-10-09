import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CreateRewardRuleRequestDto } from 'src/modules/episode-access/daily-reward/dto/create-reward-rule.request.dto';
import { UpdateRewardRuleRequestDto } from 'src/modules/episode-access/daily-reward/dto/update-reward-rule.request.dto';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';

@Injectable()
export class RewardRuleAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list() {
    return this.prisma.rewardRule.findMany({
      orderBy: { streakDay: 'asc' },
    });
  }

  async create(actorId: string, dto: CreateRewardRuleRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.rewardRule.findUnique({
        where: { code: dto.code },
      });

      if (existing) {
        throw new ConflictException({
          message: `The rule "${dto.code}" already exists`,
          details: {
            reason: 'REWARD_RULE_CODE_TAKEN',
          },
        });
      }

      const rule = await tx.rewardRule.create({
        data: {
          ...dto,
          bonusCoins: dto.bonusCoins ?? 0,
          createdById: actorId,
        },
      });

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
            coins: rule.coins,
            bonusCoins: rule.bonusCoins,
          },
        },
        tx,
      );

      return rule;
    });
  }

  async update(id: string, actorId: string, dto: UpdateRewardRuleRequestDto & { isActive?: boolean }) {
    const { isActive, ...fields } = dto;

    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.rewardRule.update({
        where: { id },
        data: {
          ...fields,
          ...(isActive === undefined ? {} : { isActive }),
        },
      });

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
          },
        },
        tx,
      );

      return rule;
    });
  }
}
