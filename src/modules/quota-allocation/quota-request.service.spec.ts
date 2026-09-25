import { ConflictException } from '@nestjs/common';
import { ProductionPlanStatus, QuotaAllocationType, QuotaRequestStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { QuotaAllocationService } from './quota-allocation.service';
import { QuotaRequestService } from './quota-request.service';

const PLAN = { id: 'plan-id', productionProjectId: 'project-id' };

describe('QuotaRequestService', () => {
  const tx = { quotaRequest: { update: jest.fn(), updateMany: jest.fn() } };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    quotaRequest: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const quotaAllocations = { allocate: jest.fn() };
  const service = new QuotaRequestService(
    prisma as unknown as PrismaService,
    quotaAllocations as unknown as QuotaAllocationService,
  );

  const givenPlan = (overrides: object = {}) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      ...PLAN,
      status: ProductionPlanStatus.APPROVED,
      productionProject: { status: 'ACTIVE' },
      quotaAllocations: [{ id: 'initial-id' }],
      quotaRequests: [],
      ...overrides,
    });
  const givenRequest = (status: QuotaRequestStatus = QuotaRequestStatus.PENDING) =>
    prisma.quotaRequest.findUnique.mockResolvedValue({
      id: 'request-id',
      status,
      requestedAmount: 800,
      productionPlan: PLAN,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    quotaAllocations.allocate.mockResolvedValue({ id: 'top-up-id' });
    tx.quotaRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.quotaRequest.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('create', () => {
    it('records a pending request on an approved plan that already has a quota', async () => {
      givenPlan();
      await service.create('plan-id', { requestedAmount: 800, reason: 'Sinh lại cảnh 3' }, 'creator-id');

      expect(prisma.quotaRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            productionPlanId: 'plan-id',
            requestedById: 'creator-id',
            requestedAmount: 800,
            reason: 'Sinh lại cảnh 3',
          },
        }),
      );
    });

    it.each([
      ['the plan has no quota yet', { quotaAllocations: [] }],
      ['the plan is not approved', { status: ProductionPlanStatus.SUBMITTED }],
      ['a request is already waiting', { quotaRequests: [{ id: 'pending' }] }],
      ['the project was cancelled', { productionProject: { status: 'CANCELLED' } }],
    ])('refuses when %s', async (_case, overrides) => {
      givenPlan(overrides);
      await expect(service.create('plan-id', { requestedAmount: 1, reason: 'x' }, 'creator-id')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.quotaRequest.create).not.toHaveBeenCalled();
    });
  });

  it('grants the approved amount as a TOP_UP and links it to the request', async () => {
    givenRequest();
    await service.approve('request-id', { approvedAmount: 600, note: 'Cấp một phần' }, 'reviewer-id');

    expect(quotaAllocations.allocate).toHaveBeenCalledWith(tx, PLAN, QuotaAllocationType.TOP_UP, 600, 'reviewer-id');
    expect(tx.quotaRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-id', status: QuotaRequestStatus.PENDING },
      data: expect.objectContaining({
        status: QuotaRequestStatus.APPROVED,
        decidedById: 'reviewer-id',
        decisionNote: 'Cấp một phần',
      }) as object,
    });
    expect((tx.quotaRequest.update.mock.calls[0] as [{ data: object }])[0].data).toEqual({
      quotaAllocationId: 'top-up-id',
    });
  });

  it('grants the requested amount when the Reviewer does not change it', async () => {
    givenRequest();
    await service.approve('request-id', {}, 'reviewer-id');

    expect(quotaAllocations.allocate).toHaveBeenCalledWith(tx, PLAN, QuotaAllocationType.TOP_UP, 800, 'reviewer-id');
  });

  it('rejects with the reason and grants nothing', async () => {
    givenRequest();
    await service.reject('request-id', { note: 'Ngân sách đã cạn' }, 'reviewer-id');

    expect(quotaAllocations.allocate).not.toHaveBeenCalled();
    expect((prisma.quotaRequest.updateMany.mock.calls[0] as [{ data: object }])[0].data).toMatchObject({
      status: QuotaRequestStatus.REJECTED,
      decisionNote: 'Ngân sách đã cạn',
    });
  });

  it('does not decide a request twice', async () => {
    givenRequest(QuotaRequestStatus.APPROVED);
    await expect(service.approve('request-id', {}, 'reviewer-id')).rejects.toThrow('was already APPROVED');
  });

  it('grants nothing when another Reviewer decided the request first', async () => {
    givenRequest();
    tx.quotaRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.approve('request-id', {}, 'reviewer-id')).rejects.toThrow('was already decided');
    expect(quotaAllocations.allocate).not.toHaveBeenCalled();
  });
});
