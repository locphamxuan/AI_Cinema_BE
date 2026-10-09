/**
 * Seeds the Membership & Billing Admin's plan catalogue: one Free plan (no price row,
 * no subscription — the free access rules grant access instead) plus paid Weekly /
 * Monthly / Yearly plans, each with its price in force. Idempotent: a plan whose
 * code already exists is left alone, and a plan that already has a price in force
 * gets no new price row, so values an Admin changed are never overwritten.
 * Needs the seed accounts first: run `prisma db seed` (or `npx tsx prisma/seed.ts`).
 * Run with `npm run seed:membership-plans` (needs DATABASE_URL).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PlanPeriod, Prisma, PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** First day the seeded prices are in force; fixed so re-runs stay deterministic. */
const PRICE_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

interface SeedPlan {
  code: string;
  name: string;
  description: string;
  period: PlanPeriod;
  durationDays: number;
  isFree: boolean;
  sortOrder: number;
  isFeatured: boolean;
  features: Prisma.InputJsonValue;
  /** Omitted for the Free plan: it must never have a price row. */
  priceCoins?: number;
}

const SEED_PLANS: SeedPlan[] = [
  {
    code: 'free',
    name: 'Gói Free',
    description: 'Mọi tài khoản bắt đầu ở đây: xem tập Free Starter và tập giá 0 Coin.',
    period: PlanPeriod.MONTHLY,
    durationDays: 30,
    isFree: true,
    sortOrder: 0,
    isFeatured: false,
    features: { maxDevices: 1, adFree: false, maxQuality: '720p' },
  },
  {
    code: 'weekly',
    name: 'Gói Tuần',
    description: 'Xem không giới hạn mọi tập trong 7 ngày, tự gia hạn.',
    period: PlanPeriod.WEEKLY,
    durationDays: 7,
    isFree: false,
    sortOrder: 1,
    isFeatured: false,
    features: { maxDevices: 1, adFree: true, maxQuality: '1080p' },
    priceCoins: 150,
  },
  {
    code: 'monthly',
    name: 'Gói Tháng',
    description: 'Xem không giới hạn mọi tập trong 30 ngày, tự gia hạn.',
    period: PlanPeriod.MONTHLY,
    durationDays: 30,
    isFree: false,
    sortOrder: 2,
    isFeatured: true,
    features: { maxDevices: 2, adFree: true, maxQuality: '1080p' },
    priceCoins: 500,
  },
  {
    code: 'yearly',
    name: 'Gói Năm',
    description: 'Xem không giới hạn mọi tập trong 365 ngày, rẻ hơn trả theo tháng.',
    period: PlanPeriod.YEARLY,
    durationDays: 365,
    isFree: false,
    sortOrder: 3,
    isFeatured: false,
    features: { maxDevices: 4, adFree: true, maxQuality: '4K' },
    priceCoins: 5000,
  },
];

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@aicinema.com' }, select: { id: true } });
  if (!admin) throw new Error('Seed accounts missing: run `prisma db seed` first');

  let newPlans = 0;
  let newPrices = 0;
  for (const seed of SEED_PLANS) {
    let plan = await prisma.membershipPlan.findUnique({ where: { code: seed.code }, select: { id: true } });
    if (!plan) {
      const { priceCoins: _price, ...planData } = seed;
      plan = await prisma.membershipPlan.create({
        data: { ...planData, createdById: admin.id },
        select: { id: true },
      });
      newPlans += 1;
    }
    if (seed.priceCoins === undefined) continue;
    const inForce = await prisma.membershipPlanPrice.findFirst({
      where: { planId: plan.id, effectiveTo: null },
      select: { id: true },
    });
    if (!inForce) {
      await prisma.membershipPlanPrice.create({
        data: {
          planId: plan.id,
          priceCoins: seed.priceCoins,
          effectiveFrom: PRICE_EFFECTIVE_FROM,
          setById: admin.id,
        },
      });
      newPrices += 1;
    }
  }
  console.log(
    `Membership plans: ${newPlans} new plan(s), ${newPrices} new price(s); ${SEED_PLANS.length} plan(s) ensured.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
