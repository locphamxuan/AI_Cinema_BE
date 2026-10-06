import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlanPeriod, type MembershipPlan, type MembershipPlanPrice as PlanPrice, type Prisma } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';

export const PLAN_REASON = { NOT_ACTIVE: 'PLAN_NOT_ACTIVE', NOT_PRICED: 'PLAN_NOT_PRICED' } as const;

/** The plan screen reads the price in force: the newest row with no effectiveTo. */
const PRICE_IN_FORCE: Prisma.MembershipPlan$pricesArgs = {
  where: { effectiveTo: null },
  orderBy: { effectiveFrom: 'desc' },
  take: 1,
};

/** What a plan costs and what it gives, without the columns only the Admin screen needs. */
const PLAN_VIEW = {
  id: true,
  code: true,
  name: true,
  description: true,
  period: true,
  durationDays: true,
  isFree: true,
  isActive: true,
  sortOrder: true,
  isFeatured: true,
  features: true,
  prices: PRICE_IN_FORCE,
} satisfies Prisma.MembershipPlanSelect;

type PlanRow = Prisma.MembershipPlanGetPayload<{ select: typeof PLAN_VIEW }>;

export type PlanView = Omit<PlanRow, 'prices'> & { priceCoins: number | null; priceId: string | null };

/**
 * The Membership & Billing Admin's catalogue. A price never overwrites: the row in force is closed
 * and a new one opens, so a subscription that already started keeps the price it was given.
 */
@Injectable()
export class MembershipPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The plans on sale, free plan first order; a Guest sees the same list as a Member. */
  listPublic() {
    return this.prisma.membershipPlan
      .findMany({ where: { isActive: true }, select: PLAN_VIEW, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
      .then((plans) => plans.map(viewOf));
  }

  /** Every plan, hidden ones included, for the Admin screen. */
  listAll() {
    return this.prisma.membershipPlan
      .findMany({ select: PLAN_VIEW, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
      .then((plans) => plans.map(viewOf));
  }

  findById(id: string): Promise<MembershipPlan> {
    return this.prisma.membershipPlan.findUniqueOrThrow({ where: { id } });
  }

  create(
    dto: {
      code: string;
      name: string;
      description?: string;
      period: PlanPeriod;
      durationDays: number;
      isFree?: boolean;
      sortOrder?: number;
      isFeatured?: boolean;
      features?: Record<string, unknown>;
    },
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.membershipPlan.create({
        data: {
          ...dto,
          isFree: dto.isFree ?? false,
          sortOrder: dto.sortOrder ?? 0,
          isFeatured: dto.isFeatured ?? false,
          features: dto.features as Prisma.InputJsonValue | undefined,
          createdById: actorId,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEMBERSHIP_PLAN_CREATED,
          entityType: 'MembershipPlan',
          entityId: plan.id,
          movieId: null,
          actorId,
          payload: { code: plan.code, period: plan.period, durationDays: plan.durationDays, isFree: plan.isFree },
        },
        tx,
      );
      return plan;
    });
  }

  /** The free plan has no price row and no subscription; the free rules grant access instead. */
  update(
    id: string,
    dto: {
      name?: string;
      description?: string;
      period?: PlanPeriod;
      durationDays?: number;
      isFree?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      isFeatured?: boolean;
      features?: Record<string, unknown>;
    },
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.membershipPlan.update({
        where: { id },
        data: { ...dto, features: dto.features as Prisma.InputJsonValue | undefined },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEMBERSHIP_PLAN_UPDATED,
          entityType: 'MembershipPlan',
          entityId: plan.id,
          movieId: null,
          actorId,
          payload: { name: plan.name, isActive: plan.isActive, isFree: plan.isFree, period: plan.period },
        },
        tx,
      );
      return plan;
    });
  }

  /**
   * Closes the price in force and opens a new one from `effectiveFrom`. Renewals after that moment
   * use the new price; the cycles already paid keep the old one.
   */
  setPrice(planId: string, priceCoins: number, effectiveFrom: Date, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
      if (plan.isFree) {
        throw new UnprocessableEntityException({
          message: 'The free plan has no price',
          details: { reason: PLAN_REASON.NOT_PRICED },
        });
      }
      const current = await currentPrice(tx, planId);
      if (current && current.priceCoins === priceCoins && current.effectiveFrom >= effectiveFrom) {
        return { price: current, plan: viewOf({ ...plan, prices: [current] }) };
      }
      if (current) {
        await tx.membershipPlanPrice.update({
          where: { id: current.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      const price = await tx.membershipPlanPrice.create({
        data: { planId, priceCoins, effectiveFrom, setById: actorId },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEMBERSHIP_PLAN_PRICE_SET,
          entityType: 'MembershipPlanPrice',
          entityId: price.id,
          movieId: null,
          actorId,
          payload: { planId, planCode: plan.code, priceCoins, effectiveFrom, closedPriceId: current?.id ?? null },
        },
        tx,
      );
      return { price, plan: viewOf({ ...plan, prices: [price] }) };
    });
  }
}

/** The newest price row of a plan with no end date: the price a new cycle is charged. */
export function currentPrice(tx: PrismaTx, planId: string, at = new Date()): Promise<PlanPrice | null> {
  return tx.membershipPlanPrice.findFirst({
    where: { planId, effectiveFrom: { lte: at }, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/** Throws the 404 and 422 the subscribe endpoints answer with when a plan cannot be bought. */
export async function purchasablePlan(
  tx: PrismaTx,
  planId: string,
): Promise<{ plan: MembershipPlan; price: PlanPrice }> {
  const plan = await tx.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundException({ message: 'Plan not found', details: { reason: 'PLAN_NOT_FOUND' } });
  if (!plan.isActive) {
    throw new UnprocessableEntityException({
      message: 'The plan is no longer on sale',
      details: { reason: PLAN_REASON.NOT_ACTIVE },
    });
  }
  if (plan.isFree) {
    throw new UnprocessableEntityException({
      message: 'The free plan needs no subscription',
      details: { reason: PLAN_REASON.NOT_PRICED },
    });
  }
  const price = await currentPrice(tx, planId);
  if (!price) {
    throw new UnprocessableEntityException({
      message: 'The plan has no price yet',
      details: { reason: PLAN_REASON.NOT_PRICED },
    });
  }
  return { plan, price };
}

/** A list of plans on the screen carries the price in force, not a raw price list. */
function viewOf(plan: PlanRow): PlanView {
  const { prices, ...rest } = plan;
  const price = prices[0] ?? null;
  return { ...rest, priceCoins: price?.priceCoins ?? null, priceId: price?.id ?? null };
}
