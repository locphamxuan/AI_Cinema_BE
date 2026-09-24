import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductionPlanStatus, QuotaAllocationStatus, QuotaAllocationType } from '@prisma/client';
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

    return this.prisma.$transaction(async (tx) => {
      // Conditional decrement in one statement: two concurrent allocations can no
      // longer both read the same balance and overspend the project budget.
      const reserved = await tx.productionProject.updateMany({
        where: { id: plan.productionProjectId, remainingAiQuotaBudget: { gte: dto.allocatedAmount } },
        data: { remainingAiQuotaBudget: { decrement: dto.allocatedAmount } },
      });
      if (reserved.count === 0) throw new BadRequestException('quota_exceeded');

      return tx.quotaAllocation.create({
        data: {
          productionPlanId: planId,
          productionProjectId: plan.productionProjectId,
          allocationType: dto.allocationType,
          allocatedAmount: dto.allocatedAmount,
          remainingAmount: dto.allocatedAmount,
          status: QuotaAllocationStatus.ACTIVE,
          allocatedById,
        },
      });
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
