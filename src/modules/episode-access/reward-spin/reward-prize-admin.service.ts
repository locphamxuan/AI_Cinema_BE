import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RewardPrizeType } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { CreateRewardPrizeRequestDto } from './dto/create-reward-prize.request.dto';
import { UpdateRewardPrizeRequestDto } from './dto/update-reward-prize.request.dto';

/** The Admin's reward wheel: what a spin can win and how likely each prize is. */
@Injectable()
export class RewardPrizeAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  list() {
    return this.prisma.rewardPrize.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(actorId: string, dto: CreateRewardPrizeRequestDto) {
    const bonus = dto.type === RewardPrizeType.BONUS_COIN;
    return this.prisma.$transaction(async (tx) => {
      if (await tx.rewardPrize.findUnique({ where: { code: dto.code } })) {
        throw new ConflictException({
          message: `The prize "${dto.code}" already exists`,
          details: { reason: 'REWARD_PRIZE_CODE_TAKEN' },
        });
      }
      const prize = await tx.rewardPrize.create({
        data: {
          code: dto.code,
          name: dto.name,
          type: dto.type,
          bonusCoins: bonus ? dto.bonusCoins : null,
          planDays: bonus ? null : dto.planDays,
          weight: dto.weight,
          createdById: actorId,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.REWARD_PRIZE_CREATED,
          entityType: 'RewardPrize',
          entityId: prize.id,
          movieId: null,
          actorId,
          payload: {
            code: prize.code,
            type: prize.type,
            bonusCoins: prize.bonusCoins,
            planDays: prize.planDays,
            weight: prize.weight,
          },
        },
        tx,
      );
      return prize;
    });
  }

  async update(id: string, actorId: string, dto: UpdateRewardPrizeRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.rewardPrize.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException({
          message: 'Reward prize not found',
          details: { reason: 'REWARD_PRIZE_NOT_FOUND' },
        });
      }
      const bonus = current.type === RewardPrizeType.BONUS_COIN;
      if ((bonus && dto.planDays !== undefined) || (!bonus && dto.bonusCoins !== undefined)) {
        throw new BadRequestException({
          message: `A ${current.type} prize does not take that amount`,
          details: { reason: 'REWARD_PRIZE_AMOUNT_MISMATCH' },
        });
      }
      const prize = await tx.rewardPrize.update({ where: { id }, data: dto });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.REWARD_PRIZE_UPDATED,
          entityType: 'RewardPrize',
          entityId: prize.id,
          movieId: null,
          actorId,
          payload: { ...dto },
        },
        tx,
      );
      return prize;
    });
  }
}
