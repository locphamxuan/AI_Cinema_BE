import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CoinReferenceType } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CoinSpendService } from '../coin-wallet/coin-spend.service';
import { WalletService } from '../coin-wallet/wallet.service';

/** The business day is Vietnam's, so a reward cannot be claimed twice by moving the clock. */
const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';

/** The ladder runs over seven days; after the last one it starts again. */
const LADDER_LENGTH = 7;

const DAY_MS = 86_400_000;

/** The next three days of bonus Coins that run out, so the check-in screen can warn about them. */
const EXPIRING_HORIZON_DAYS = 7;
const EXPIRING_LIMIT = 3;

export const CHECKIN_REASON = { ALREADY_TODAY: 'ALREADY_CHECKED_IN_TODAY' } as const;

/** What one streak day pays: the Admin's rule, or nothing when that day is switched off. */
interface Reward {
  coins: number;
  bonusCoins: number;
}

/**
 * Midnight of the business day `at` falls in. The `@db.Date` column stores that day, so the unique
 * (user_id, check_in_date) row is what stops a second claim on the same day.
 */
export function businessDay(at = new Date()): Date {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * Step 12: the daily check-in. One reward per business day, counted on the Vietnam date rather
 * than the client's clock, and the Coins are bonus Coins so they run out with their lot.
 */
@Injectable()
export class DailyRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinSpendService,
    private readonly wallets: WalletService,
  ) {}

  /** What the check-in screen shows: today's state, the ladder and what runs out soon. */
  async status(userId: string) {
    const today = businessDay();
    const wallet = await this.wallets.walletOf(userId);
    const [todayCheckIn, lastCheckIn, rules, expiringBonus] = await Promise.all([
      this.prisma.dailyCheckIn.findUnique({ where: { userId_checkInDate: { userId, checkInDate: today } } }),
      this.prisma.dailyCheckIn.findFirst({ where: { userId }, orderBy: { checkInDate: 'desc' } }),
      this.prisma.rewardRule.findMany({ where: { isActive: true }, orderBy: { streakDay: 'asc' } }),
      this.prisma.coinLot.findMany({
        where: {
          walletId: wallet.id,
          remainingAmount: { gt: 0 },
          closedAt: null,
          expiresAt: { gt: new Date(), lte: new Date(Date.now() + EXPIRING_HORIZON_DAYS * DAY_MS) },
        },
        orderBy: { expiresAt: 'asc' },
        take: EXPIRING_LIMIT,
        select: { id: true, remainingAmount: true, expiresAt: true },
      }),
    ]);
    const streakDay =
      todayCheckIn?.streakDay ?? (this.isYesterday(lastCheckIn?.checkInDate, today) ? lastCheckIn!.streakDay : 0);
    return {
      checkInDate: today,
      checkedInToday: Boolean(todayCheckIn),
      streakDay,
      streakContinued: this.isYesterday(lastCheckIn?.checkInDate, today) && !todayCheckIn,
      reward: this.rewardOf(rules, this.nextStreakDay(streakDay)),
      ladder: rules.map((rule) => ({ streakDay: rule.streakDay, coins: rule.coins, bonusCoins: rule.bonusCoins })),
      mainBalance: wallet.mainBalance,
      bonusBalance: wallet.bonusBalance,
      expiringBonus: expiringBonus.map(({ id, remainingAmount, expiresAt }) => ({
        lotId: id,
        amount: remainingAmount,
        expiresAt,
      })),
    };
  }

  /**
   * Pays today's reward. The unique (user_id, check_in_date) row makes a second claim on the same
   * business day fail, whatever the client sends; the Idempotency-Key stops a retried request from
   * paying twice on a day the first attempt already got through.
   */
  async checkIn(userId: string, idempotencyKey?: string) {
    const today = businessDay();
    const wallet = await this.wallets.walletOf(userId);
    const [todayCheckIn, lastCheckIn] = await Promise.all([
      this.prisma.dailyCheckIn.findUnique({ where: { userId_checkInDate: { userId, checkInDate: today } } }),
      this.prisma.dailyCheckIn.findFirst({ where: { userId }, orderBy: { checkInDate: 'desc' } }),
    ]);
    if (todayCheckIn) throw this.alreadyToday(today);

    const streakOn = lastCheckIn && this.isYesterday(lastCheckIn.checkInDate, today) ? lastCheckIn.streakDay : 0;
    const streakDay = (streakOn % LADDER_LENGTH) + 1;
    const reward = await this.rewardOfStreakDay(streakDay);
    if (reward.coins + reward.bonusCoins <= 0) {
      // No ladder for today: nothing to pay, so nothing is written.
      throw new UnprocessableEntityException({
        message: 'No reward is set for today',
        details: { reason: 'NO_REWARD_TODAY', streakDay },
      });
    }
    const streakContinued = streakOn > 0;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const movement = await this.coins.credit(
          tx,
          wallet.id,
          {
            entryType: CoinEntryType.DAILY_REWARD,
            mainAmount: reward.coins,
            bonusAmount: reward.bonusCoins,
            lotSource: CoinLotSource.DAILY_REWARD,
            referenceType: CoinReferenceType.DAILY_CHECK_IN,
            idempotencyKey,
            description: `Daily check-in, day ${streakDay} of the streak`,
          },
          today,
        );
        const checkIn = await tx.dailyCheckIn.create({
          data: {
            userId,
            walletId: wallet.id,
            checkInDate: today,
            streakDay,
            streakContinued,
            coinsGranted: movement.mainCoins,
            bonusGranted: movement.bonusCoins,
            coinTransactionId: movement.transactionId,
            ruleId: reward.ruleId,
          },
        });
        return {
          checkInDate: checkIn.checkInDate,
          streakDay: checkIn.streakDay,
          streakContinued: checkIn.streakContinued,
          coinsGranted: checkIn.coinsGranted,
          bonusGranted: checkIn.bonusGranted,
          mainBalance: movement.mainBalance,
          bonusBalance: movement.bonusBalance,
        };
      });
    } catch (error) {
      // The unique row is the real guard; the check above only saves the obvious repeat.
      if (await this.checkedInToday(userId, today)) throw this.alreadyToday(today);
      throw error;
    }
  }

  /** The Admin's rule for that streak day, or nothing when the day is switched off. */
  private async rewardOfStreakDay(streakDay: number): Promise<Reward & { ruleId: string | null }> {
    const rule = await this.prisma.rewardRule.findFirst({
      where: { isActive: true, streakDay },
      orderBy: { streakDay: 'asc' },
    });
    return { coins: rule?.coins ?? 0, bonusCoins: rule?.bonusCoins ?? 0, ruleId: rule?.id ?? null };
  }

  /** The same answer as `rewardOfStreakDay` but from an already-loaded ladder. */
  private rewardOf(rules: { streakDay: number; coins: number; bonusCoins: number }[], streakDay: number) {
    const rule = rules.find((row) => row.streakDay === streakDay);
    return { streakDay, coins: rule?.coins ?? 0, bonusCoins: rule?.bonusCoins ?? 0 };
  }

  /** The streak number a check-in today would carry: yesterday's plus one, or 1 after a gap. */
  private nextStreakDay(streakDay: number): number {
    return (streakDay % LADDER_LENGTH) + 1;
  }

  /** A streak continues only when the previous check-in was the business day before today. */
  private isYesterday(checkInDate: Date | undefined | null, today: Date): boolean {
    return Boolean(checkInDate) && checkInDate!.getTime() === today.getTime() - DAY_MS;
  }

  private checkedInToday(userId: string, today: Date): Promise<boolean> {
    return this.prisma.dailyCheckIn.count({ where: { userId, checkInDate: today } }).then((count) => count > 0);
  }

  private alreadyToday(today: Date) {
    return new UnprocessableEntityException({
      message: 'This day has already been checked in',
      details: { reason: CHECKIN_REASON.ALREADY_TODAY, checkInDate: today },
    });
  }
}
