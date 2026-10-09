import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, type Prisma } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { COIN_REASON, type AdjustmentRequest, type CoinMovement } from './coin-wallet.types';
import { bonusOf, bumpWallet, consumeLots, lockWallet, spendableLots } from './lot-usage';

/**
 * A manual correction of a wallet by the Admin. History is never edited: the correction is a new
 * ADJUSTMENT ledger row that points back at nothing but carries the reason, and a bonus debit
 * leaves the lots the same way a purchase does, so the bonus balance stays the sum of its lots.
 */
@Injectable()
export class CoinAdjustService {
  constructor(private readonly settings: PlatformSettingService) {}

  async apply(tx: PrismaTx, walletId: string, request: AdjustmentRequest, now = new Date()): Promise<CoinMovement> {
    const mainAmount = request.mainAmount ?? 0;
    const bonusAmount = request.bonusAmount ?? 0;
    if (mainAmount === 0 && bonusAmount === 0) {
      throw new ConflictException({
        message: 'An adjustment needs a main or a bonus amount',
        details: { reason: COIN_REASON.NOTHING_TO_ADJUST },
      });
    }
    // A bonus debit empties lots, and one ledger row is written per lot. Mixing a main debit into
    // the same correction would lose the main part, so the Admin sends two requests instead and
    // the answer says so rather than silently dropping half of what was asked for.
    if (bonusAmount < 0 && mainAmount !== 0) {
      throw new ConflictException({
        message: 'A correction cannot move main and bonus Coins at once when it takes Coins out',
        details: { reason: COIN_REASON.SPLIT_THE_CORRECTION, mainAmount, bonusAmount },
      });
    }
    const rateVnd = request.rateVnd ?? (await this.settings.get()).coinRateVnd;
    const wanted = { ...request, rateVnd };
    return bonusAmount < 0 ? this.debitBonus(tx, walletId, wanted, now) : this.debitMain(tx, walletId, wanted, now);
  }

  /** Only main Coins move: too negative is refused, the wallet never goes below zero. */
  private async debitMain(
    tx: PrismaTx,
    walletId: string,
    request: AdjustmentRequest,
    now: Date,
  ): Promise<CoinMovement> {
    const mainAmount = request.mainAmount ?? 0;
    const bonusAmount = request.bonusAmount ?? 0;
    await lockWallet(tx, walletId);
    const wallet = await tx.coinWallet.findUniqueOrThrow({ where: { id: walletId } });
    if (wallet.mainBalance + mainAmount < 0) {
      throw new UnprocessableEntityException({
        message: 'The wallet does not hold that many main Coins',
        details: {
          reason: COIN_REASON.INSUFFICIENT_COINS,
          requiredCoins: -mainAmount,
          mainBalance: wallet.mainBalance,
        },
      });
    }
    const mainBalance = wallet.mainBalance + mainAmount;
    const bonusBalance = wallet.bonusBalance + bonusAmount;
    const lotId = bonusAmount > 0 ? await this.openLot(tx, walletId, bonusAmount, now) : null;
    const [entry] = await tx.coinTransaction.createManyAndReturn({
      data: [this.row(walletId, request, mainAmount, bonusAmount, lotId, mainBalance, bonusBalance)],
    });
    await bumpWallet(tx, walletId, mainBalance, bonusBalance);
    return { transactionId: entry.id, mainCoins: mainAmount, bonusCoins: bonusAmount, mainBalance, bonusBalance };
  }

  /** A bonus debit empties lots, the one expiring first first, one ledger row per lot. */
  private async debitBonus(
    tx: PrismaTx,
    walletId: string,
    request: AdjustmentRequest,
    now: Date,
  ): Promise<CoinMovement> {
    const wanted = -(request.bonusAmount ?? 0);
    await lockWallet(tx, walletId);
    const wallet = await tx.coinWallet.findUniqueOrThrow({ where: { id: walletId } });
    const lots = await spendableLots(tx, walletId, now);
    const available = bonusOf(lots);
    if (available < wanted) {
      throw new UnprocessableEntityException({
        message: 'The wallet does not hold that many bonus Coins',
        details: {
          reason: COIN_REASON.INSUFFICIENT_COINS,
          requiredCoins: wanted,
          bonusBalance: available,
          missingCoins: wanted - available,
        },
      });
    }
    const rateVnd = request.rateVnd!;
    const rows: Prisma.CoinTransactionCreateManyInput[] = [];
    let bonusAfter = wallet.bonusBalance;
    for (const debit of await consumeLots(tx, lots, wanted, now)) {
      bonusAfter -= debit.amount;
      rows.push({
        ...this.row(walletId, request, 0, -debit.amount, debit.id, wallet.mainBalance, bonusAfter),
        rateVnd,
        idempotencyKey: rows.length === 0 ? request.idempotencyKey : null,
      });
    }
    const [first] = await tx.coinTransaction.createManyAndReturn({ data: rows });
    await bumpWallet(tx, walletId, wallet.mainBalance, bonusAfter);
    return {
      transactionId: first.id,
      mainCoins: 0,
      bonusCoins: wanted,
      mainBalance: wallet.mainBalance,
      bonusBalance: bonusAfter,
    };
  }

  private row(
    walletId: string,
    request: AdjustmentRequest,
    mainAmount: number,
    bonusAmount: number,
    lotId: string | null,
    mainBalance: number,
    bonusBalance: number,
  ): Prisma.CoinTransactionCreateManyInput {
    return {
      walletId,
      entryType: CoinEntryType.ADJUSTMENT,
      mainAmount,
      bonusAmount,
      rateVnd: request.rateVnd ?? 0,
      lotId,
      idempotencyKey: request.idempotencyKey,
      mainBalanceAfter: mainBalance,
      bonusBalanceAfter: bonusBalance,
      description: request.reason.trim(),
      createdById: request.createdById,
    };
  }

  private async openLot(tx: PrismaTx, walletId: string, bonusAmount: number, now: Date): Promise<string> {
    const days = (await this.settings.get()).bonusCoinExpiryDays;
    const lot = await tx.coinLot.create({
      data: {
        walletId,
        source: CoinLotSource.ADJUSTMENT,
        originalAmount: bonusAmount,
        remainingAmount: bonusAmount,
        grantedAt: now,
        expiresAt: new Date(now.getTime() + days * 86_400_000),
      },
    });
    return lot.id;
  }
}
