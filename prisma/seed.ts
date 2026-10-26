import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../src/common/auth/permissions';
import { GENRE_CATALOG } from './genre-catalog';
import { createAccounts, SEED_USER_PASSWORD, topUpReviewerBudgets } from './seed-accounts';
import { ADMIN_EMAIL, SEED_ACCOUNTS, SEED_POLICIES, SEED_REWARD_PRIZES, SEED_REWARD_RULES } from './seed-data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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

/** The default ladder and wheel; rows the Admin already has (by code) are left as they are. */
async function seedRewards() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  for (const rule of SEED_REWARD_RULES) {
    const taken = await prisma.rewardRule.count({ where: { streakDay: rule.streakDay, isActive: true } });
    if (taken) continue;
    await prisma.rewardRule.upsert({
      where: { code: rule.code },
      update: {},
      create: { ...rule, createdById: admin.id },
    });
  }
  for (const prize of SEED_REWARD_PRIZES) {
    await prisma.rewardPrize.upsert({
      where: { code: prize.code },
      update: {},
      create: { ...prize, createdById: admin.id },
    });
  }
}

async function main() {
  for (const { name, description } of GENRE_CATALOG) {
    await prisma.genre.upsert({ where: { name }, update: { description }, create: { name, description } });
  }
  await seedPermissions();
  await seedPolicies();
  await createAccounts(prisma, SEED_ACCOUNTS, SEED_USER_PASSWORD);
  const reviewers = SEED_ACCOUNTS.filter((a) => a.role === UserRole.CONTENT_REVIEWER).map((a) => a.email);
  await topUpReviewerBudgets(prisma, reviewers, ADMIN_EMAIL);
  await seedRewards();
  console.log('Seeded genres, permissions, policies, the four platform accounts, the Reviewer budget and rewards.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
