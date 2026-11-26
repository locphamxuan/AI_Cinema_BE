import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RewardPrizeType, RewardSpinStatus, type RewardPrize } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { CreateRewardPrizeRequestDto } from './dto/create-reward-prize.request.dto';
import { SetRewardChancesRequestDto } from './dto/set-reward-chances.request.dto';
import { UpdateRewardPrizeRequestDto } from './dto/update-reward-prize.request.dto';
import { assertWheelAddsUp, lockWheel, otherActiveWeights } from './wheel-total';

export const PRIZE_REASON = {
  NOT_FOUND: 'REWARD_PRIZE_NOT_FOUND',
  LAST_ACTIVE: 'REWARD_PRIZE_LAST_ACTIVE',
  LISTED_TWICE: 'REWARD_PRIZE_LISTED_TWICE',
} as const;

const notFound = () =>
  new NotFoundException({ message: 'Reward prize not found', details: { reason: PRIZE_REASON.NOT_FOUND } });

/**
 * The Admin's reward wheel: what a spin can win and its chance in basis points (`weight`, 10 000 = 100 %).
 * The prizes switched on always add up to exactly 100 %: a create, edit, switch or delete that breaks it is
 * refused, and `setChances` rebalances every prize in one save. Deleting removes the row for good, while every
 * spin that won it keeps its own copy of the prize (name, type, amount).
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
    const isActive = dto.isActive ?? true;
    return this.prisma.$transaction(async (tx) => {
      await lockWheel(tx);
      if (await tx.rewardPrize.findUnique({ where: { code: dto.code } })) {
        throw new ConflictException({
          message: `The prize "${dto.code}" already exists`,
          details: { reason: 'REWARD_PRIZE_CODE_TAKEN' },
        });
      }
      if (isActive) assertWheelAddsUp([...(await otherActiveWeights(tx)), dto.weight]);
      const prize = await tx.rewardPrize.create({
        data: {
          code: dto.code,
          name: dto.name,
          type: dto.type,
          bonusCoins: bonus ? dto.bonusCoins : null,
          planDays: bonus ? null : dto.planDays,
          weight: dto.weight,
          isActive,
          createdById: actorId,
        },
      });
      await this.record(tx, CONTENT_EVENT.REWARD_PRIZE_CREATED, prize.id, actorId, {
        code: prize.code,
        type: prize.type,
        bonusCoins: prize.bonusCoins,
        planDays: prize.planDays,
        weight: prize.weight,
        isActive,
      });
      return prize;
    });
  }

  async update(id: string, actorId: string, dto: UpdateRewardPrizeRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockPrize(tx, id);
      const bonus = current.type === RewardPrizeType.BONUS_COIN;
      if ((bonus && dto.planDays !== undefined) || (!bonus && dto.bonusCoins !== undefined)) {
        throw new BadRequestException({
          message: `A ${current.type} prize does not take that amount`,
          details: { reason: 'REWARD_PRIZE_AMOUNT_MISMATCH' },
        });
      }
      const isActive = dto.isActive ?? current.isActive;
      const weight = dto.weight ?? current.weight;
      // Only a change of the chances on the wheel is checked: renaming a prize never is.
      if ((current.isActive || isActive) && (isActive !== current.isActive || weight !== current.weight)) {
        const others = await otherActiveWeights(tx, id);
        if (!isActive) await assertWheelKeepsAPrize(tx, others.length);
        assertWheelAddsUp(isActive ? [...others, weight] : others);
      }
      const prize = await tx.rewardPrize.update({ where: { id }, data: dto });
      await this.record(tx, CONTENT_EVENT.REWARD_PRIZE_UPDATED, prize.id, actorId, { ...dto });
      return prize;
    });
  }

  /**
   * Sets the chance of every prize in one save: the prizes listed are switched on with their new weight, every
   * other prize is switched off. The listed weights must add up to exactly 100 %.
   */
  async setChances(actorId: string, dto: SetRewardChancesRequestDto) {
    const ids = dto.prizes.map((prize) => prize.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        message: 'A prize is listed twice',
        details: { reason: PRIZE_REASON.LISTED_TWICE },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await lockWheel(tx);
      const prizes = await tx.rewardPrize.findMany({ select: { id: true, isActive: true } });
      const known = new Set(prizes.map((prize) => prize.id));
      if (ids.some((prizeId) => !known.has(prizeId))) throw notFound();
      assertWheelAddsUp(dto.prizes.map((prize) => prize.weight));
      const switchedOff = prizes.filter((prize) => prize.isActive && !ids.includes(prize.id)).map((p) => p.id);
      for (const { id, weight } of dto.prizes) {
        await tx.rewardPrize.update({ where: { id }, data: { weight, isActive: true } });
      }
      if (switchedOff.length) {
        await tx.rewardPrize.updateMany({ where: { id: { in: switchedOff } }, data: { isActive: false } });
      }
      // One audit row per prize that changed, each saying it came from a rebalance of the whole wheel.
      await this.auditLog.recordMany(
        [
          ...dto.prizes.map(({ id, weight }) => ({ id, payload: { weight, isActive: true, rebalanced: true } })),
          ...switchedOff.map((id) => ({ id, payload: { isActive: false, rebalanced: true } })),
        ].map(({ id, payload }) => ({
          action: CONTENT_EVENT.REWARD_PRIZE_UPDATED,
          entityType: 'RewardPrize' as const,
          entityId: id,
          projectId: null,
          actorId,
          payload,
        })),
        tx,
      );
    });
    return this.list();
  }

  /**
   * Deletes the prize for good; it disappears from the list. Spins that won it keep their copy and only lose
   * the link (ON DELETE SET NULL). An active prize can only go when it is the last one switched on: otherwise
   * the wheel would no longer add up to 100 %, so the Admin switches it off with the new chances first.
   */
  async remove(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockPrize(tx, id);
      if (current.isActive) {
        const others = await otherActiveWeights(tx, id);
        await assertWheelKeepsAPrize(tx, others.length);
        assertWheelAddsUp(others);
      }
      await tx.rewardPrize.delete({ where: { id } });
      await this.record(tx, CONTENT_EVENT.REWARD_PRIZE_REMOVED, id, actorId, {
        code: current.code,
        name: current.name,
        type: current.type,
        bonusCoins: current.bonusCoins,
        planDays: current.planDays,
        weight: current.weight,
        wasActive: current.isActive,
      });
      return { id, deleted: true };
    });
  }

  private record(tx: PrismaTx, action: ContentEvent, entityId: string, actorId: string, payload: object) {
    return this.auditLog.record(
      { action, entityType: 'RewardPrize', entityId, projectId: null, actorId, payload: { ...payload } },
      tx,
    );
  }
}

/** Locks the wheel, so two Admins never change it at once, and reads the prize. */
async function lockPrize(tx: PrismaTx, id: string): Promise<RewardPrize> {
  await lockWheel(tx);
  const prize = await tx.rewardPrize.findUnique({ where: { id } });
  if (!prize) throw notFound();
  return prize;
}

/**
 * The wheel may not lose its last active prize while a member still holds an unused spin: that member could
 * no longer spin. With no spin waiting, the wheel may be emptied (members only see the preview until a prize
 * is switched on again).
 */
async function assertWheelKeepsAPrize(tx: PrismaTx, othersActive: number) {
  if (othersActive > 0) return;
  const waiting = await tx.rewardSpin.count({ where: { status: RewardSpinStatus.AVAILABLE } });
  if (waiting > 0) {
    throw new ConflictException({
      message: 'This is the last prize on the wheel and members still have spins to use',
      details: { reason: PRIZE_REASON.LAST_ACTIVE, waitingSpins: waiting },
    });
  }
}
