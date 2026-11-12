import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../src/common/auth/permissions';
import { GENRE_CATALOG } from './genre-catalog';
import { createAccounts, SEED_USER_PASSWORD } from './seed-accounts';
import {
  ADMIN_EMAIL,
  SEED_ACCOUNTS,
  SEED_POLICIES,
  SEED_REWARD_PRIZES,
  SEED_REWARD_RULES,
  SEED_STAFF_ACCOUNT,
  SEED_STAFF_PASSWORD,
} from './seed-data';

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

/** MF-1 (07/11/2026): a partner studio with one STUDIO login, so the Studio Web can be demoed right away. */
export const DEMO_STUDIO = { name: 'Lumen Studio', email: 'contact@lumenstudio.example' };
export const DEMO_STUDIO_LOGIN = 'studio@aicinema.com';

async function seedDemoStudio() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const studio = await prisma.studio.upsert({
    where: { email: DEMO_STUDIO.email },
    update: {},
    create: { ...DEMO_STUDIO, contactName: 'Nguyễn Thị Lan', createdById: admin.id },
  });
  if (await prisma.user.count({ where: { email: DEMO_STUDIO_LOGIN } })) return;
  await prisma.user.create({
    data: {
      email: DEMO_STUDIO_LOGIN,
      fullName: 'Lumen Studio',
      role: UserRole.STUDIO,
      studioId: studio.id,
      passwordHash: await bcrypt.hash(SEED_USER_PASSWORD, 12),
    },
  });
}

/** The demo Staff login always ends up with SEED_STAFF_PASSWORD, even when the account existed before. */
async function seedStaffLogin() {
  const passwordHash = await bcrypt.hash(SEED_STAFF_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: SEED_STAFF_ACCOUNT.email },
    update: { passwordHash, role: SEED_STAFF_ACCOUNT.role, isActive: true },
    create: { ...SEED_STAFF_ACCOUNT, passwordHash },
  });
}

async function main() {
  for (const { name, description } of GENRE_CATALOG) {
    await prisma.genre.upsert({ where: { name }, update: { description }, create: { name, description } });
  }
  await seedPermissions();
  await seedPolicies();
  await createAccounts(prisma, SEED_ACCOUNTS, SEED_USER_PASSWORD);
  await seedStaffLogin();
  await seedRewards();
  await seedDemoStudio();
  console.log('Seeded genres, permissions, policies, the platform accounts, rewards and the demo studio.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
