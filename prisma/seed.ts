import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../src/common/auth/permissions';
import { GENRE_CATALOG } from './genre-catalog';
import { SEED_POLICIES, SEED_USERS } from './seed-data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';
// Placeholder hashes an earlier seed stored; they are replaced so the account can sign in.
const PLACEHOLDER_HASH_PREFIX = '$2b$10$dummy';

const users = [
  // CONTENT CREATORS
  {
    email: 'creator01@aicinema.com',
    fullName: 'Nguyễn Minh Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator02@aicinema.com',
    fullName: 'Trần Quốc Bảo',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator03@aicinema.com',
    fullName: 'Lê Hoàng Nam',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator04@aicinema.com',
    fullName: 'Phạm Gia Huy',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator05@aicinema.com',
    fullName: 'Võ Thành Đạt',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator06@aicinema.com',
    fullName: 'Đặng Nhật Minh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator07@aicinema.com',
    fullName: 'Bùi Đức Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator08@aicinema.com',
    fullName: 'Ngô Tuấn Kiệt',
    role: UserRole.CONTENT_CREATOR,
  },

  // CONTENT REVIEWERS
  {
    email: 'reviewer01@aicinema.com',
    fullName: 'Nguyễn Thu Hà',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer02@aicinema.com',
    fullName: 'Trần Ngọc Linh',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer03@aicinema.com',
    fullName: 'Lê Thanh Hương',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer04@aicinema.com',
    fullName: 'Phạm Khánh Vy',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer05@aicinema.com',
    fullName: 'Vũ Minh Trang',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer06@aicinema.com',
    fullName: 'Đỗ Hoàng Long',
    role: UserRole.CONTENT_REVIEWER,
  },

  // STAFF / ADMIN / MEMBER
  {
    email: 'staff01@aicinema.com',
    fullName: 'Nguyễn Văn Thành',
    role: UserRole.STAFF,
  },
  {
    email: 'admin@aicinema.com',
    fullName: 'AI Cinema Admin',
    role: UserRole.ADMIN,
  },
  {
    email: 'member01@aicinema.com',
    fullName: 'Nguyễn Hoàng Anh',
    role: UserRole.MEMBER,
  },
  // Tester accounts with password 123456
  {
    email: 'adminn@gmail.com',
    fullName: 'Admin Tester',
    role: UserRole.ADMIN,
    password: '123456',
  },
  {
    email: 'creatorr@gmail.com',
    fullName: 'Creator Tester',
    role: UserRole.CONTENT_CREATOR,
    password: '123456',
  },
  {
    email: 'reviewerr@gmail.com',
    fullName: 'Reviewer Tester',
    role: UserRole.CONTENT_REVIEWER,
    password: '123456',
  },
];

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
  const defaultPasswordHash = await bcrypt.hash(SEED_USER_PASSWORD, 10);
  for (const user of users) {
    const { password, ...userData } = user as any;
    const userHash = password ? await bcrypt.hash(password, 10) : defaultPasswordHash;
    const existing = await prisma.user.findUnique({ where: { email: userData.email } });
    if (!existing) {
      await prisma.user.create({ data: { ...userData, passwordHash: userHash, isActive: true } });
      continue;
    }
    // A password someone already set is kept; only placeholder hashes or explicitly provided passwords are replaced.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: userData.fullName,
        role: userData.role,
        isActive: true,
        ...(password || existing.passwordHash.startsWith(PLACEHOLDER_HASH_PREFIX) ? { passwordHash: userHash } : {}),
      },
    });
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
}

async function main() {
  for (const { name, description } of GENRE_CATALOG) {
    await prisma.genre.upsert({ where: { name }, update: { description }, create: { name, description } });
  }
  await seedPermissions();
  await seedPolicies();
  await seedUsers();
  console.log('Seeded genres, permissions, policies and development accounts.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
