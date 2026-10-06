import { UnprocessableEntityException } from '@nestjs/common';
import { PlanPeriod } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { currentPrice, MembershipPlanService, PLAN_REASON, purchasablePlan } from './membership-plan.service';

describe('purchasablePlan', () => {
  const tx = { membershipPlan: { findUnique: jest.fn() }, membershipPlanPrice: { findFirst: jest.fn() } };
  const plan = { id: 'p1', code: 'MONTHLY', isActive: true, isFree: false };
  const price = { id: 'price-1', priceCoins: 900 };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(price);
  });

  it('returns the plan with the price in force', async () => {
    await expect(purchasablePlan(tx as unknown as PrismaTx, 'p1')).resolves.toEqual({ plan, price });
  });

  it('answers 404 for a missing plan', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue(null);

    await expect(purchasablePlan(tx as unknown as PrismaTx, 'missing')).rejects.toMatchObject({
      response: {
        statusCode: 404,
        details: {
          reason: 'PLAN_NOT_FOUND',
        },
      },
    });
  });

  it('answers 422 for a hidden plan', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue({
      ...plan,
      isActive: false,
    });

    await expect(purchasablePlan(tx as unknown as PrismaTx, 'p1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: PLAN_REASON.NOT_ACTIVE,
        },
      },
    });
  });

  it('answers 422 for the free plan and for a plan with no price', async () => {
    tx.membershipPlan.findUnique.mockResolvedValue({
      ...plan,
      isFree: true,
    });

    await expect(purchasablePlan(tx as unknown as PrismaTx, 'p1')).rejects.toBeInstanceOf(UnprocessableEntityException);

    tx.membershipPlan.findUnique.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(null);

    await expect(purchasablePlan(tx as unknown as PrismaTx, 'p1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: PLAN_REASON.NOT_PRICED,
        },
      },
    });
  });
});

describe('currentPrice', () => {
  const tx = { membershipPlanPrice: { findFirst: jest.fn() } };

  it('reads the newest open row at the given moment', async () => {
    tx.membershipPlanPrice.findFirst.mockResolvedValue({ id: 'price-1', priceCoins: 900 });
    const at = new Date('2026-10-05T00:00:00.000Z');

    await currentPrice(tx as unknown as PrismaTx, 'p1', at);

    expect(tx.membershipPlanPrice.findFirst).toHaveBeenCalledWith({
      where: { planId: 'p1', effectiveFrom: { lte: at }, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
  });
});

describe('MembershipPlanService.setPrice', () => {
  const tx = {
    membershipPlan: { findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
    membershipPlanPrice: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    membershipPlan: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new MembershipPlanService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);

  const plan = {
    id: 'p1',
    code: 'MONTHLY',
    name: 'Monthly',
    description: null,
    period: PlanPeriod.MONTHLY,
    durationDays: 30,
    isFree: false,
    isActive: true,
    sortOrder: 1,
    isFeatured: false,
    features: null,
  };
  const current = { id: 'price-1', priceCoins: 900, effectiveFrom: new Date('2026-09-01T00:00:00.000Z') };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.membershipPlan.findUniqueOrThrow.mockResolvedValue(plan);
    tx.membershipPlanPrice.findFirst.mockResolvedValue(current);
    tx.membershipPlanPrice.update.mockResolvedValue({ ...current, effectiveTo: new Date() });
    tx.membershipPlanPrice.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'price-2',
      ...data,
    }));
  });

  it('closes the price in force and opens the new one, keeping history', async () => {
    const effectiveFrom = new Date('2026-11-01T00:00:00.000Z');
    const result = await service.setPrice('p1', 950, effectiveFrom, 'admin-1');

    expect(tx.membershipPlanPrice.update).toHaveBeenCalledWith({
      where: { id: 'price-1' },
      data: { effectiveTo: effectiveFrom },
    });
    expect(tx.membershipPlanPrice.create).toHaveBeenCalledWith({
      data: { planId: 'p1', priceCoins: 950, effectiveFrom, setById: 'admin-1' },
    });
    expect(result.price).toMatchObject({ priceCoins: 950 });
    expect(result.plan).toMatchObject({ priceCoins: 950, priceId: 'price-2' });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.MEMBERSHIP_PLAN_PRICE_SET,
        entityType: 'MembershipPlanPrice',
        actorId: 'admin-1',
      }),
      tx,
    );
  });

  it('repeats the idempotent answer when the same price already stands', async () => {
    const result = await service.setPrice('p1', 900, new Date('2026-08-01T00:00:00.000Z'), 'admin-1');

    expect(result.price).toEqual(current);
    expect(tx.membershipPlanPrice.update).not.toHaveBeenCalled();
    expect(tx.membershipPlanPrice.create).not.toHaveBeenCalled();
  });

  it('refuses to price the free plan', async () => {
    tx.membershipPlan.findUniqueOrThrow.mockResolvedValue({
      ...plan,
      isFree: true,
    });

    await expect(service.setPrice('p1', 100, new Date(), 'admin-1')).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: PLAN_REASON.NOT_PRICED,
        },
      },
    });
  });

  it('opens the first price when the plan never had one', async () => {
    tx.membershipPlanPrice.findFirst.mockResolvedValue(null);

    await service.setPrice('p1', 900, new Date('2026-11-01T00:00:00.000Z'), 'admin-1');

    expect(tx.membershipPlanPrice.update).not.toHaveBeenCalled();
    expect(tx.membershipPlanPrice.create).toHaveBeenCalled();
  });
});

describe('MembershipPlanService lists', () => {
  const prisma = {
    $transaction: jest.fn(),
    membershipPlan: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new MembershipPlanService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);

  const row = {
    id: 'p1',
    code: 'MONTHLY',
    name: 'Monthly',
    period: PlanPeriod.MONTHLY,
    prices: [{ id: 'price-1', priceCoins: 900 }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.membershipPlan.findMany.mockResolvedValue([row]);
  });

  it('listPublic reads only the plans on sale, with the price in force', async () => {
    const plans = await service.listPublic();

    expect(prisma.membershipPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, select: expect.anything() }),
    );
    expect(plans).toEqual([{ ...row, prices: undefined, priceCoins: 900, priceId: 'price-1' }]);
  });

  it('listAll keeps the hidden ones for the Admin screen', async () => {
    await service.listAll();
    expect(prisma.membershipPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.anything() }));
  });
});
