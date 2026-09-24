import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionPlanStatus, QuotaAllocationStatus, QuotaAllocationType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateQuotaAllocationRequestDto } from './dto/create-quota-allocation.request.dto';

@Injectable()
export class QuotaAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreateQuotaAllocationRequestDto, allocatedById: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    if (plan.status !== ProductionPlanStatus.APPROVED) {
      throw new ConflictException(
        `AI quota can only be allocated to an APPROVED plan, current status "${plan.status}"`,
      );
    }

    if (dto.allocationType === QuotaAllocationType.INITIAL) {
      const existing = await this.prisma.quotaAllocation.findFirst({
        where: { productionPlanId: planId, allocationType: QuotaAllocationType.INITIAL },
      });
      if (existing) {
        throw new ConflictException('An INITIAL quota allocation already exists for this plan');
      }
    }

    return this.prisma.$transaction((tx) =>
      this.allocate(tx, plan, dto.allocationType, dto.allocatedAmount, allocatedById),
    );
  }

  /** Moves tokens from the project budget into a new ACTIVE allocation of the plan. */
  async allocate(
    tx: Prisma.TransactionClient,
    plan: { id: string; productionProjectId: string },
    allocationType: QuotaAllocationType,
    amount: number,
    allocatedById: string,
  ) {
    // Conditional decrement in one statement: two concurrent allocations can no
    // longer both read the same balance and overspend the project budget.
    const reserved = await tx.productionProject.updateMany({
      where: { id: plan.productionProjectId, remainingAiQuotaBudget: { gte: amount } },
      data: { remainingAiQuotaBudget: { decrement: amount } },
    });
    if (reserved.count === 0) throw new BadRequestException('quota_exceeded');

    return tx.quotaAllocation.create({
      data: {
        productionPlanId: plan.id,
        productionProjectId: plan.productionProjectId,
        allocationType,
        allocatedAmount: amount,
        remainingAmount: amount,
        status: QuotaAllocationStatus.ACTIVE,
        allocatedById,
      },
    });
  }

  async findAll(planId: string) {
    await this.requirePlan(planId);
    return this.prisma.quotaAllocation.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    return plan;
  }
}
