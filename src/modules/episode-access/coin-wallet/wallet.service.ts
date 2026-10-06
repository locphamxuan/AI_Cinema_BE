import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CoinReferenceType, type CoinWallet, type Prisma } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CoinSpendService } from './coin-spend.service';
import { COIN_REASON, type CoinSplit } from './coin-wallet.types';

/** Bonus lots shown on the wallet screen so a member sees what runs out first. */
const EXPIRING_LIMIT = 5;

/**
 * The reading side of a wallet: what a member sees on the Coin screen and what every purchase
 * screen asks before offering a price. Only CoinSpendService writes; this service opens wallets
 * and answers "may this member afford that".
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly coins: CoinSpendService,
  ) {}

  /** The wallet of an account, opened on the spot for accounts that predate the Coin flow. */
  walletOf(userId: string, tx?: PrismaTx): Promise<CoinWallet> {
    return (tx ?? this.prisma).coinWallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  /**
   * Registration step 5: the wallet is opened in the transaction that creates the account, and
   * the welcome bonus is paid into it there as well, so a member who exists always has a wallet.
   */
  async openForNewAccount(tx: PrismaTx, userId: string, now = new Date()): Promise<CoinWallet> {
    const wallet = await tx.coinWallet.create({ data: { userId } });
    const { newMemberBonusCoins } = await this.settings.get();
    if (newMemberBonusCoins > 0) {
      await this.coins.credit(
        tx,
        wallet.id,
        {
          entryType: CoinEntryType.SIGNUP_BONUS,
          bonusAmount: newMemberBonusCoins,
          lotSource: CoinLotSource.SIGNUP_BONUS,
          referenceType: CoinReferenceType.ADMIN,
          description: 'Bonus Coins of a new account',
        },
        now,
      );
    }
    return wallet;
  }

  /** The Coin screen: the two balances and the bonus batches that run out soonest. */
  async view(userId: string) {
    const wallet = await this.walletOf(userId);
    const expiringBonus = await this.prisma.coinLot.findMany({
      where: { walletId: wallet.id, remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: EXPIRING_LIMIT,
      select: { id: true, remainingAmount: true, expiresAt: true },
    });
    return {
      mainBalance: wallet.mainBalance,
      bonusBalance: wallet.bonusBalance,
      version: wallet.version,
      expiringBonus: expiringBonus.map(({ id, remainingAmount, expiresAt }) => ({
        lotId: id,
        amount: remainingAmount,
        expiresAt,
      })),
    };
  }

  /** Step 11 and 14: the balance and exactly how a price would be covered, main Coins first. */
  async affordability(userId: string, amountCoins: number) {
    const wallet = await this.walletOf(userId);
    const bonus = await this.spendableBonus(wallet.id);
    const plannedSplit = this.plannedSplit(wallet.mainBalance, bonus, amountCoins);
    return {
      requiredCoins: amountCoins,
      mainBalance: wallet.mainBalance,
      bonusBalance: bonus,
      enoughCoins: plannedSplit.mainCoins + plannedSplit.bonusCoins >= amountCoins,
      missingCoins: Math.max(0, amountCoins - wallet.mainBalance - bonus),
      plannedSplit,
    };
  }

  /** How much of a price comes out of main Coins and how much out of the bonus Coins. */
  plannedSplit(mainBalance: number, bonusBalance: number, amountCoins: number): CoinSplit {
    const mainCoins = Math.min(mainBalance, amountCoins);
    return { mainCoins, bonusCoins: Math.min(bonusBalance, amountCoins - mainCoins) };
  }

  /** Throws the 422 the purchase endpoints answer with when the wallet cannot cover a price. */
  async assertAffordable(userId: string, amountCoins: number): Promise<CoinSplit> {
    const plan = await this.affordability(userId, amountCoins);
    if (plan.enoughCoins) return plan.plannedSplit;
    throw new UnprocessableEntityException({
      message: 'The wallet does not hold enough Coins for this purchase',
      details: { reason: COIN_REASON.INSUFFICIENT_COINS, ...plan },
    });
  }

  /** Bonus Coins that may still be spent right now: expired batches are not spendable. */
  async spendableBonus(walletId: string, tx?: PrismaTx): Promise<number> {
    const { _sum } = await (tx ?? this.prisma).coinLot.aggregate({
      where: { walletId, remainingAmount: { gt: 0 }, closedAt: null, expiresAt: { gt: new Date() } },
      _sum: { remainingAmount: true },
    });
    return _sum.remainingAmount ?? 0;
  }

  /** A member's wallet with every batch still usable; what Billing support reads. */
  adminView(userId: string) {
    return this.prisma.coinWallet
      .findUnique({
        where: { userId },
        select: { id: true, userId: true, mainBalance: true, bonusBalance: true, version: true, updatedAt: true },
      })
      .then(async (wallet) => (wallet ? { ...wallet, lots: await this.openLots(wallet.id) } : null));
  }

  openLots(walletId: string, where?: Prisma.CoinLotWhereInput) {
    return this.prisma.coinLot.findMany({
      where: { walletId, remainingAmount: { gt: 0 }, closedAt: null, ...where },
      orderBy: { expiresAt: 'asc' },
    });
  }
}
