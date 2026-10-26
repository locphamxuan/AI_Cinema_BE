import * as bcrypt from 'bcrypt';
import { type PrismaClient, ReviewerTokenEntryType, type UserRole } from '@prisma/client';

/** What every account a seed creates signs in with, until its owner changes it. */
export const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';

export interface SeedAccount {
  email: string;
  fullName: string;
  role: UserRole;
  dateOfBirth?: Date;
}

/** Creates the missing accounts with `password`; an account that exists keeps its name and password. */
export async function createAccounts(prisma: PrismaClient, accounts: SeedAccount[], password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: { role: account.role },
      create: { ...account, passwordHash },
    });
  }
}

/** Reviewers always have at least this many Token to allocate as production fees outside production. */
const REVIEWER_BUDGET = 1_000_000;

/** Tops each Reviewer's budget back up to REVIEWER_BUDGET, granted by `adminEmail`. */
export async function topUpReviewerBudgets(prisma: PrismaClient, reviewerEmails: string[], adminEmail: string) {
  const reviewers = await prisma.user.findMany({ where: { email: { in: reviewerEmails } }, select: { id: true } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { id: true } });
  const settings = await prisma.platformSetting.findUnique({ where: { id: 'default' } });
  for (const { id } of reviewers) {
    const [granted, allocated] = await Promise.all([
      prisma.reviewerTokenEntry.aggregate({ where: { reviewerId: id }, _sum: { amountTokens: true } }),
      prisma.tokenLedgerEntry.aggregate({ where: { createdById: id }, _sum: { amountTokens: true } }),
    ]);
    const balance = Number(granted._sum.amountTokens ?? 0n) - Number(allocated._sum.amountTokens ?? 0n);
    if (balance >= REVIEWER_BUDGET) continue;
    await prisma.reviewerTokenEntry.create({
      data: {
        reviewerId: id,
        entryType: ReviewerTokenEntryType.GRANT,
        amountTokens: BigInt(REVIEWER_BUDGET - balance),
        rateVnd: settings?.tokenRateVnd ?? 1000,
        reason: 'Ngân sách Token cho môi trường phát triển',
        createdById: admin.id,
      },
    });
  }
}
