import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RewardPrizeType, RewardSpinStatus, type RewardPrize } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { CreateRewardPrizeRequestDto } from './dto/create-reward-prize.request.dto';
import { UpdateRewardPrizeRequestDto } from './dto/update-reward-prize.request.dto';

export const PRIZE_REASON = {
  NOT_FOUND: 'REWARD_PRIZE_NOT_FOUND',
  LAST_ACTIVE: 'REWARD_PRIZE_LAST_ACTIVE',
} as const;

/**
 * The Admin's reward wheel: what a spin can win and how likely each prize is. Switching a prize
 * on/off (PATCH isActive) and deleting it (DELETE) are separate: a delete removes the row for
 * good, while every spin that won it keeps its own copy of the prize (name, type, amount).
 */
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
          projectId: null,
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
      const current = await lockPrize(tx, id);
      if (current.isActive && dto.isActive === false) await assertWheelKeepsAPrize(tx, id);
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
          projectId: null,
          actorId,
          payload: { ...dto },
        },
        tx,
      );
      return prize;
    });
  }

  /**
   * Deletes the prize for good; it disappears from the list. Spins that won it keep their copy and
   * only lose the link (ON DELETE SET NULL). A spin in progress holds the prize FOR SHARE, so the
   * delete waits for it to commit.
   */
  async remove(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockPrize(tx, id);
      if (current.isActive) await assertWheelKeepsAPrize(tx, id);
      await tx.rewardPrize.delete({ where: { id } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.REWARD_PRIZE_REMOVED,
          entityType: 'RewardPrize',
          entityId: id,
          projectId: null,
          actorId,
          payload: {
            code: current.code,
            name: current.name,
            type: current.type,
            bonusCoins: current.bonusCoins,
            planDays: current.planDays,
            weight: current.weight,
            wasActive: current.isActive,
          },
        },
        tx,
      );
      return { id, deleted: true };
    });
  }
}

/** Reads the prize and locks the active ones, so two Admins cannot empty the wheel at once. */
async function lockPrize(tx: PrismaTx, id: string): Promise<RewardPrize> {
  await tx.$queryRaw`SELECT "id" FROM "reward_prizes" WHERE "is_active" = true OR "id" = ${id}::uuid ORDER BY "id" FOR UPDATE`;
  const prize = await tx.rewardPrize.findUnique({ where: { id } });
  if (!prize) {
    throw new NotFoundException({ message: 'Reward prize not found', details: { reason: PRIZE_REASON.NOT_FOUND } });
  }
  return prize;
}

/**
 * The wheel may not lose its last active prize while a member still holds an unused spin: that
 * member could no longer spin. With no spin waiting, the wheel may be emptied (members only see
 * the preview until a prize is added again).
 */
async function assertWheelKeepsAPrize(tx: PrismaTx, leavingId: string) {
  const others = await tx.rewardPrize.count({ where: { isActive: true, id: { not: leavingId } } });
  if (others > 0) return;
  const waiting = await tx.rewardSpin.count({ where: { status: RewardSpinStatus.AVAILABLE } });
  if (waiting > 0) {
    throw new ConflictException({
      message: 'This is the last prize on the wheel and members still have spins to use',
      details: { reason: PRIZE_REASON.LAST_ACTIVE, waitingSpins: waiting },
    });
  }
}
