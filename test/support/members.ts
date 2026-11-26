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
