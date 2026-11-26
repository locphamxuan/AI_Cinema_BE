import { INestApplication } from '@nestjs/common';
import { CoinEntryType, CoinLotSource } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CoinSpendService } from 'src/modules/episode-access/coin-wallet/coin-spend.service';
import { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import { type Actor, signIn } from './api';

let registered = 0;

/** A brand-new adult member with an empty wallet, signed in. */
export async function registerMember(app: INestApplication<App>): Promise<Actor> {
  registered += 1;
  const email = `member-${Date.now()}-${registered}@aicinema.test`;
  const password = 'Member@123';
  await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, fullName: 'Thành viên e2e', dateOfBirth: '2000-01-01', acceptedTerms: true })
    .expect(201);
  return signIn(app, email, password);
}

/**
 * Puts Coins in a member's wallet for a test, now that the Admin can no longer correct a balance by hand: main
 * Coins in one row, then one bonus lot per entry of `bonusLots`, written through the real ledger service.
 */
export async function fundWallet(
  app: INestApplication<App>,
  userId: string,
  mainAmount: number,
  bonusLots: number[] = [],
  entryType: CoinEntryType = CoinEntryType.ADJUSTMENT,
): Promise<void> {
  const prisma = app.get(PrismaService);
  const coins = app.get(CoinSpendService);
  const wallet = await app.get(WalletService).walletOf(userId);
  const credits = [...(mainAmount ? [{ mainAmount }] : []), ...bonusLots.map((bonusAmount) => ({ bonusAmount }))];
  for (const credit of credits) {
    await prisma.$transaction((tx) =>
      coins.credit(tx, wallet.id, { entryType, lotSource: CoinLotSource.ADJUSTMENT, description: 'e2e', ...credit }),
    );
  }
}

/** A running Monthly plan, e.g. for watch rooms (BR-69), written straight to the database. */
export async function giveMonthlyPlan(app: INestApplication<App>, userId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const now = new Date();
  if (await prisma.subscription.count({ where: { userId, status: 'ACTIVE', currentPeriodEnd: { gt: now } } })) return;
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
  // Kept off sale, so it never shows up among the plans other suites list or buy.
  const plan = await prisma.membershipPlan.upsert({
    where: { code: 'e2e_watch_party_monthly' },
    update: {},
    create: {
      code: 'e2e_watch_party_monthly',
      name: 'Gói Tháng e2e xem nhóm',
      period: 'MONTHLY',
      durationDays: 30,
      isActive: false,
      createdById: admin.id,
    },
  });
  const end = new Date(now.getTime() + 30 * 86_400_000);
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      priceCoins: 300,
      autoRenew: false,
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: end,
    },
  });
}
