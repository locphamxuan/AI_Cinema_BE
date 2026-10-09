import { ConflictException } from '@nestjs/common';
import type { CoinLot } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/** How many Coins a debit takes out of one bonus lot. */
export interface LotDebit {
  id: string;
  amount: number;
}

/** Serialises the writers of one wallet, so "main before bonus" and "never negative" hold. */
export function lockWallet(tx: PrismaTx, walletId: string): Promise<unknown> {
  return tx.$queryRaw`SELECT id FROM coin_wallets WHERE id = ${walletId}::uuid FOR UPDATE`;
}

/**
 * Bonus lots that may still be spent, the one expiring first first. Every open lot is returned, so
 * a wallet that collected many small promotions is not reported as short of Coins.
 */
export function spendableLots(tx: PrismaTx, walletId: string, now: Date): Promise<CoinLot[]> {
  return tx.coinLot.findMany({
    where: { walletId, remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: 'asc' }, { grantedAt: 'asc' }],
  });
}

/** How many spendable bonus Coins a wallet holds right now, summed in the database. */
export function spendableBonus(tx: PrismaTx, walletId: string, now: Date): Promise<number> {
  return tx.coinLot
    .aggregate({
      where: { walletId, remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { gt: now } },
      _sum: { remainingAmount: true },
    })
    .then(({ _sum }) => _sum.remainingAmount ?? 0);
}

/** Sums the Coins left in a set of lots, for a caller that already has the rows. */
export function bonusOf(lots: { remainingAmount: number }[]): number {
  return lots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
}

/**
 * Takes `amount` out of the given lots, the one expiring first first, and closes a lot once its
 * last Coin is gone. `amount` must not exceed what the lots hold.
 */
export async function consumeLots(
  tx: PrismaTx,
  lots: { id: string; remainingAmount: number }[],
  amount: number,
  now: Date,
): Promise<LotDebit[]> {
  const debits: LotDebit[] = [];
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const taken = Math.min(lot.remainingAmount, left);
    const remaining = lot.remainingAmount - taken;
    await tx.coinLot.update({
      where: { id: lot.id },
      data: { remainingAmount: remaining, closedAt: remaining === 0 ? now : null },
    });
    debits.push({ id: lot.id, amount: taken });
    left -= taken;
  }
  return debits;
}

/** Writes the two counters of the wallet; the version tells a lost update from a fresh read. */
export async function bumpWallet(
  tx: PrismaTx,
  walletId: string,
  mainBalance: number,
  bonusBalance: number,
): Promise<void> {
  const { count } = await tx.coinWallet.updateMany({
    where: { id: walletId },
    data: { mainBalance, bonusBalance, version: { increment: 1 } },
  });
  if (count === 0) throw new ConflictException({ message: 'The wallet changed meanwhile; retry' });
}
