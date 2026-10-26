import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { createAccounts, type SeedAccount, SEED_USER_PASSWORD, topUpReviewerBudgets } from '../../prisma/seed-accounts';
import { ADMIN_EMAIL } from '../../prisma/seed-data';

/**
 * Accounts only the e2e suites use: a second Reviewer and Creator to prove one cannot touch another's
 * project, an Admin besides the seeded one, and a Member. They live in the e2e database alone;
 * `prisma db seed` keeps a real database to the platform's four accounts.
 */
const E2E_ACCOUNTS: SeedAccount[] = [
  ...[1, 2, 3].map((n) => ({
    email: `creator0${n}@aicinema.com`,
    fullName: `Creator e2e ${n}`,
    role: UserRole.CONTENT_CREATOR,
  })),
  ...[1, 2, 6].map((n) => ({
    email: `reviewer0${n}@aicinema.com`,
    fullName: `Reviewer e2e ${n}`,
    role: UserRole.CONTENT_REVIEWER,
  })),
  { email: 'admin@aicinema.com', fullName: 'Admin e2e', role: UserRole.ADMIN },
  {
    email: 'member01@aicinema.com',
    fullName: 'Member e2e',
    role: UserRole.MEMBER,
    dateOfBirth: new Date('2002-08-15'),
  },
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    await createAccounts(prisma, E2E_ACCOUNTS, SEED_USER_PASSWORD);
    const reviewers = E2E_ACCOUNTS.filter((a) => a.role === UserRole.CONTENT_REVIEWER).map((a) => a.email);
    await topUpReviewerBudgets(prisma, reviewers, ADMIN_EMAIL);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
