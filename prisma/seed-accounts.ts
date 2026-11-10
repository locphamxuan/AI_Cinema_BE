import * as bcrypt from 'bcrypt';
import type { PrismaClient, UserRole } from '@prisma/client';

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
