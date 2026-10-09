import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ReviewerTokenEntryType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../src/common/auth/permissions';
import { GENRE_CATALOG } from './genre-catalog';
import { SEED_POLICIES, SEED_TEST_USERS, SEED_USERS } from './seed-data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';

/** Permission catalog from code; a role gets the default matrix only while it has no permission at all. */
async function seedPermissions() {
  for (const [key, { area, description }] of Object.entries(PERMISSION_CATALOG)) {
    await prisma.permission.upsert({
      where: { key },
      update: { area, description },
      create: { key, area, description },
    });
  }
  await prisma.permission.deleteMany({ where: { key: { notIn: Object.keys(PERMISSION_CATALOG) } } });

  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const typedRole = role as keyof typeof DEFAULT_ROLE_PERMISSIONS;
    if (await prisma.rolePermission.count({ where: { role: typedRole } })) continue;
    await prisma.rolePermission.createMany({ data: keys.map((permissionKey) => ({ role: typedRole, permissionKey })) });
  }
}

async function seedPolicies() {
  for (const policy of SEED_POLICIES) {
    const existing = await prisma.policy.findFirst({ where: { name: policy.name, version: policy.version } });
    if (existing) continue;
    await prisma.policy.create({ data: { ...policy, effectiveFrom: new Date('2026-05-01T00:00:00.000Z') } });
  }
}

/** Creates missing accounts; a password someone already changed is kept. */
async function seedUsers() {
  const passwordHash = await bcrypt.hash(SEED_USER_PASSWORD, 12);
  for (const user of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { fullName: user.fullName, role: user.role },
      create: { ...user, passwordHash },
    });
  }
  for (const { password, ...user } of SEED_TEST_USERS) {
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email: user.email },
      update: { fullName: user.fullName, role: user.role, passwordHash: hash, isActive: true },
      create: { ...user, passwordHash: hash },
    });
  }
}

/** Development Reviewers always have at least this many Token to allocate as production fees. */
const DEV_REVIEWER_BUDGET = 1_000_000;

/** Tops every seeded Reviewer's budget back up to DEV_REVIEWER_BUDGET, granted by the seeded Admin. */
async function seedReviewerBudgets() {
  const emails = [...SEED_USERS, ...SEED_TEST_USERS]
    .filter((u) => u.role === UserRole.CONTENT_REVIEWER)
    .map((u) => u.email);
  const reviewers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@aicinema.com' }, select: { id: true } });
  const settings = await prisma.platformSetting.findUnique({ where: { id: 'default' } });
  for (const { id } of reviewers) {
    const [granted, allocated] = await Promise.all([
      prisma.reviewerTokenEntry.aggregate({ where: { reviewerId: id }, _sum: { amountTokens: true } }),
      prisma.tokenLedgerEntry.aggregate({ where: { createdById: id }, _sum: { amountTokens: true } }),
    ]);
    const balance = Number(granted._sum.amountTokens ?? 0n) - Number(allocated._sum.amountTokens ?? 0n);
    if (balance >= DEV_REVIEWER_BUDGET) continue;
    await prisma.reviewerTokenEntry.create({
      data: {
        reviewerId: id,
        entryType: ReviewerTokenEntryType.GRANT,
        amountTokens: BigInt(DEV_REVIEWER_BUDGET - balance),
        rateVnd: settings?.tokenRateVnd ?? 1000,
        reason: 'Ngân sách Token cho môi trường phát triển',
        createdById: admin.id,
      },
    });
  }
}

async function main() {
  for (const { name, description } of GENRE_CATALOG) {
    await prisma.genre.upsert({ where: { name }, update: { description }, create: { name, description } });
  }
  await seedPermissions();
  await seedPolicies();
  await seedUsers();
  await seedReviewerBudgets();
  console.log('Seeded genres, permissions, policies, development accounts and Reviewer budgets.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
