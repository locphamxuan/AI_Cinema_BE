import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionPlanStatus, QuotaAllocationStatus, QuotaAllocationType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { QuotaAllocationService } from './quota-allocation.service';

describe('QuotaAllocationService.create', () => {
  const tx = {
    productionProject: { updateMany: jest.fn() },
    quotaAllocation: { create: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    quotaAllocation: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new QuotaAllocationService(prisma as unknown as PrismaService);
  const dto = { allocationType: QuotaAllocationType.INITIAL, allocatedAmount: 500 };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      productionProjectId: 'project-id',
      status: ProductionPlanStatus.APPROVED,
    });
    prisma.quotaAllocation.findFirst.mockResolvedValue(null);
    tx.quotaAllocation.create.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));
  });

  it('reserves the amount from the project budget with a conditional decrement', async () => {
    tx.productionProject.updateMany.mockResolvedValue({ count: 1 });

    const allocation = await service.create('plan-id', dto, 'reviewer-id');

    expect(tx.productionProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-id', remainingAiQuotaBudget: { gte: 500 } },
      data: { remainingAiQuotaBudget: { decrement: 500 } },
    });
    expect(allocation).toMatchObject({
      allocatedAmount: 500,
      remainingAmount: 500,
      status: QuotaAllocationStatus.ACTIVE,
      allocatedById: 'reviewer-id',
    });
  });

  it('rejects the allocation when the budget no longer covers it (e.g. a concurrent allocation won)', async () => {
    tx.productionProject.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create('plan-id', dto, 'reviewer-id')).rejects.toThrow(BadRequestException);
    expect(tx.quotaAllocation.create).not.toHaveBeenCalled();
  });

  it('only allocates to an approved plan, and only one INITIAL allocation per plan', async () => {
    prisma.productionPlan.findUnique.mockResolvedValueOnce({ id: 'plan-id', status: ProductionPlanStatus.SUBMITTED });
    await expect(service.create('plan-id', dto, 'reviewer-id')).rejects.toThrow(ConflictException);

    prisma.quotaAllocation.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await expect(service.create('plan-id', dto, 'reviewer-id')).rejects.toThrow('INITIAL quota allocation already');
  });
});
