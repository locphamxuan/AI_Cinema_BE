import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, type CoinTransaction, type Prisma } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { COIN_REASON, type CoinMovement, type CreditRequest, type SpendRequest } from './coin-wallet.types';
import { bonusOf, bumpWallet, consumeLots, lockWallet, spendableLots } from './lot-usage';

/**
 * The only place a Coin balance changes. Every call takes the wallet row with FOR UPDATE,
 * writes the coin_transactions rows that explain the move and updates the two counters in the
 * same transaction, so the wallet is never out of step with its ledger. Buying an episode,
 * buying a series, paying for a plan and renewing one all go through here, which keeps the
 * "main Coins before bonus Coins" rule in one file.
 */
@Injectable()
export class CoinSpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  /** Takes Coins out: main first, then the bonus lots that expire first. */
  async spend(tx: PrismaTx, walletId: string, request: SpendRequest, now = new Date()): Promise<CoinMovement> {
    const replayed = await this.replayed(request.idempotencyKey, tx);
    if (replayed) return this.movementOf(replayed);
    if (request.amountCoins <= 0) throw new ConflictException({ message: 'A Coin payment must be more than 0' });

    const wallet = await this.locked(tx, walletId);
    const mainCoins = Math.min(wallet.mainBalance, request.amountCoins);
    const bonusCoins = request.amountCoins - mainCoins;
    const lots = await spendableLots(tx, walletId, now);
    const available = bonusOf(lots);
    if (available < bonusCoins) {
      throw new UnprocessableEntityException({
        message: 'The wallet does not hold enough Coins for this purchase',
        details: {
          reason: COIN_REASON.INSUFFICIENT_COINS,
          requiredCoins: request.amountCoins,
          mainBalance: wallet.mainBalance,
          bonusBalance: available,
          missingCoins: request.amountCoins - wallet.mainBalance - available,
        },
      });
    }

    const debits = await consumeLots(tx, lots, bonusCoins, now);
    const rateVnd = request.coinRateVnd ?? (await this.settings.get()).coinRateVnd;
    const rows: Prisma.CoinTransactionCreateManyInput[] = [];
    let mainAfter = wallet.mainBalance;
    let bonusAfter = wallet.bonusBalance;
    // Main Coins leave on the first row; every lot the bonus part touched gets a row of its own.
    const debitRow = (main: number, bonus: number, lotId?: string) => {
      mainAfter += main;
      bonusAfter += bonus;
      rows.push({
        walletId,
        entryType: request.entryType,
        mainAmount: main,
        bonusAmount: bonus,
        rateVnd,
        lotId,
        referenceType: request.referenceType,
        referenceId: request.referenceId,
        // Only the first row carries the key, so a retry finds the entry and moves nothing again.
        idempotencyKey: rows.length === 0 ? request.idempotencyKey : null,
        mainBalanceAfter: mainAfter,
        bonusBalanceAfter: bonusAfter,
        description: request.description,
      });
    };
    debitRow(-mainCoins, 0);
    for (const debit of debits) debitRow(0, -debit.amount, debit.id);

    const [first] = await tx.coinTransaction.createManyAndReturn({ data: rows });
    await bumpWallet(tx, walletId, mainAfter, bonusAfter);
    return { transactionId: first.id, mainCoins, bonusCoins, mainBalance: mainAfter, bonusBalance: bonusAfter };
  }

  /** Adds Coins; a bonus amount opens a lot so those Coins still know when they run out. */
  async credit(tx: PrismaTx, walletId: string, request: CreditRequest, now = new Date()): Promise<CoinMovement> {
    const replayed = await this.replayed(request.idempotencyKey, tx);
    if (replayed) return this.movementOf(replayed);
    const mainAmount = request.mainAmount ?? 0;
    const bonusAmount = request.bonusAmount ?? 0;
    if (mainAmount === 0 && bonusAmount === 0) throw new ConflictException({ message: 'Nothing to credit' });

    const settings = await this.settings.get();
    const wallet = await this.locked(tx, walletId);
    const lotId = request.lotId ?? (await this.openLot(tx, walletId, request, bonusAmount, now));
    const mainBalance = wallet.mainBalance + mainAmount;
    const bonusBalance = wallet.bonusBalance + bonusAmount;
    const [entry] = await tx.coinTransaction.createManyAndReturn({
      data: [
        {
          walletId,
          entryType: request.entryType,
          mainAmount,
          bonusAmount,
          rateVnd: request.rateVnd ?? settings.coinRateVnd,
          lotId,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          reversesId: request.reversesId,
          idempotencyKey: request.idempotencyKey,
          mainBalanceAfter: mainBalance,
          bonusBalanceAfter: bonusBalance,
          description: request.description,
          createdById: request.createdById,
        },
      ],
    });
    await bumpWallet(tx, walletId, mainBalance, bonusBalance);
    return { transactionId: entry.id, mainCoins: mainAmount, bonusCoins: bonusAmount, mainBalance, bonusBalance };
  }

  /**
   * BR-28: the Coins of an expired lot leave the wallet. The lot is closed by the caller in the
   * same transaction; this writes the single BONUS_EXPIRY row that keeps the ledger complete.
   */
  async expireBonus(
    tx: PrismaTx,
    walletId: string,
    lot: { id: string; amount: number; expiresAt: Date },
  ): Promise<CoinMovement> {
    const wallet = await this.locked(tx, walletId);
    const bonusBalance = wallet.bonusBalance - lot.amount;
    const [entry] = await tx.coinTransaction.createManyAndReturn({
      data: [
        {
          walletId,
          entryType: CoinEntryType.BONUS_EXPIRY,
          mainAmount: 0,
          bonusAmount: -lot.amount,
          rateVnd: (await this.settings.get()).coinRateVnd,
          lotId: lot.id,
          mainBalanceAfter: wallet.mainBalance,
          bonusBalanceAfter: bonusBalance,
          description: `Bonus Coins expired on ${lot.expiresAt.toISOString().slice(0, 10)}`,
        },
      ],
    });
    await bumpWallet(tx, walletId, wallet.mainBalance, bonusBalance);
    return {
      transactionId: entry.id,
      mainCoins: 0,
      bonusCoins: lot.amount,
      mainBalance: wallet.mainBalance,
      bonusBalance,
    };
  }

  /** Opens the lot a bonus credit lands in; null when no bonus Coins are credited. */
  private async openLot(
    tx: PrismaTx,
    walletId: string,
    request: CreditRequest,
    bonusAmount: number,
    now: Date,
  ): Promise<string | null> {
    if (bonusAmount <= 0) return null;
    const days = request.expiresInDays ?? (await this.settings.get()).bonusCoinExpiryDays;
    const lot = await tx.coinLot.create({
      data: {
        walletId,
        source: request.lotSource,
        originalAmount: bonusAmount,
        remainingAmount: bonusAmount,
        grantedAt: now,
        expiresAt: new Date(now.getTime() + days * 86_400_000),
      },
    });
    return lot.id;
  }

  private async locked(tx: PrismaTx, walletId: string) {
    await lockWallet(tx, walletId);
    return tx.coinWallet.findUniqueOrThrow({ where: { id: walletId } });
  }

  private replayed(idempotencyKey: string | undefined, tx: PrismaTx): Promise<CoinTransaction | null> {
    return idempotencyKey ? tx.coinTransaction.findUnique({ where: { idempotencyKey } }) : Promise.resolve(null);
  }

  private movementOf(entry: CoinTransaction): CoinMovement {
    return {
      transactionId: entry.id,
      mainCoins: -entry.mainAmount,
      bonusCoins: -entry.bonusAmount,
      mainBalance: entry.mainBalanceAfter,
      bonusBalance: entry.bonusBalanceAfter,
    };
  }
}
