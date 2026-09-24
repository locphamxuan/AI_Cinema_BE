import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionPlanStatus, QuotaAllocationType, QuotaRequestStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateQuotaRequestRequestDto } from './dto/create-quota-request.request.dto';
import { ApproveQuotaRequestRequestDto, RejectQuotaRequestRequestDto } from './dto/decide-quota-request.request.dto';
import { QuotaAllocationService } from './quota-allocation.service';

const REQUEST_INCLUDE = {
  requestedBy: { select: { id: true, fullName: true } },
  decidedBy: { select: { id: true, fullName: true } },
};

/**
 * Quota adjustment (PROJECT_OVERVIEW.md, Production Budget): a Creator whose quota
 * runs low asks for more tokens; the Reviewer grants all or part of it as a TOP_UP
 * allocation from the project budget, or turns it down with a reason.
 */
@Injectable()
export class QuotaRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaAllocations: QuotaAllocationService,
  ) {}

  async create(planId: string, dto: CreateQuotaRequestRequestDto, requestedById: string) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { quotaAllocations: { select: { id: true } }, quotaRequests: { where: { status: 'PENDING' } } },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    if (plan.status !== ProductionPlanStatus.APPROVED || plan.quotaAllocations.length === 0) {
      throw new ConflictException('More quota can only be requested once the plan is approved and has a quota');
    }
    if (plan.quotaRequests.length > 0) {
      throw new ConflictException('This plan already has a quota request waiting for the Reviewer');
    }

    return this.prisma.quotaRequest.create({
      data: { productionPlanId: planId, requestedById, requestedAmount: dto.requestedAmount, reason: dto.reason },
      include: REQUEST_INCLUDE,
    });
  }

  findAll(planId: string) {
    return this.prisma.quotaRequest.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: REQUEST_INCLUDE,
    });
  }

  async approve(requestId: string, dto: ApproveQuotaRequestRequestDto, decidedById: string) {
    const request = await this.requirePending(requestId);
    const amount = dto.approvedAmount ?? request.requestedAmount;

    return this.prisma.$transaction(async (tx) => {
      await this.decide(tx, requestId, QuotaRequestStatus.APPROVED, decidedById, dto.note);
      const allocation = await this.quotaAllocations.allocate(
        tx,
        request.productionPlan,
        QuotaAllocationType.TOP_UP,
        amount,
        decidedById,
      );
      return tx.quotaRequest.update({
        where: { id: requestId },
        data: { quotaAllocationId: allocation.id },
        include: { ...REQUEST_INCLUDE, quotaAllocation: true },
      });
    });
  }

  async reject(requestId: string, dto: RejectQuotaRequestRequestDto, decidedById: string) {
    await this.requirePending(requestId);
    await this.decide(this.prisma, requestId, QuotaRequestStatus.REJECTED, decidedById, dto.note);

    return this.prisma.quotaRequest.findUnique({ where: { id: requestId }, include: REQUEST_INCLUDE });
  }

  /**
   * Leaves PENDING in one conditional statement: two Reviewers deciding at once can
   * no longer both pass requirePending and grant the top-up twice.
   */
  private async decide(
    client: Prisma.TransactionClient | PrismaService,
    requestId: string,
    status: QuotaRequestStatus,
    decidedById: string,
    decisionNote: string | undefined,
  ) {
    const decided = await client.quotaRequest.updateMany({
      where: { id: requestId, status: QuotaRequestStatus.PENDING },
      data: { status, decidedById, decisionNote, decidedAt: new Date() },
    });
    if (decided.count === 0) throw new ConflictException(`Quota request "${requestId}" was already decided`);
  }

  private async requirePending(requestId: string) {
    const request = await this.prisma.quotaRequest.findUnique({
      where: { id: requestId },
      include: { productionPlan: { select: { id: true, productionProjectId: true } } },
    });
    if (!request) throw new NotFoundException(`Quota request with id "${requestId}" does not exist`);
    if (request.status !== QuotaRequestStatus.PENDING) {
      throw new ConflictException(`Quota request "${requestId}" was already ${request.status}`);
    }
    return request;
  }
}
