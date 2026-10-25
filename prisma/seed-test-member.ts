/**
 * Seeds one member account for trying the daily check-in and the reward wheel (on mobile or web):
 *   email testvongquay@gmail.com / password testvongquay
 * It has a streak of 6 days ending yesterday, so today's check-in is the day-7 milestone that earns a spin,
 * and 3 spins already waiting. Running it again puts the account back in that state (check-ins and spins
 * are rebuilt; the Coin wallet keeps whatever it won). It also fills an empty reward ladder and wheel with the defaults.
 * Run with `npm run seed:test-member` (needs DATABASE_URL).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RewardSpinStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SEED_REWARD_PRIZES, SEED_REWARD_RULES } from './seed-data';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const EMAIL = 'testvongquay@gmail.com';
const PASSWORD = 'testvongquay';
const STREAK_DAYS = 6;
const WAITING_SPINS = 3;
const DAY_MS = 86_400_000;

/** Midnight of today's Vietnam business day, as the `@db.Date` column stores it. */
function businessDay(at = new Date()): Date {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Fills the ladder and the wheel only where the Admin has none, as `npm run seed` does; nothing existing is touched. */
async function ensureRewards() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: UserRole.ADMIN }, orderBy: { createdAt: 'asc' } });
  for (const rule of SEED_REWARD_RULES) {
    if (await prisma.rewardRule.count({ where: { streakDay: rule.streakDay, isActive: true } })) continue;
    await prisma.rewardRule.upsert({
      where: { code: rule.code },
      update: { isActive: true },
      create: { ...rule, createdById: admin.id },
    });
  }
  if ((await prisma.rewardPrize.count({ where: { isActive: true } })) === 0) {
    for (const prize of SEED_REWARD_PRIZES) {
      await prisma.rewardPrize.upsert({
        where: { code: prize.code },
        update: { isActive: true },
        create: { ...prize, createdById: admin.id },
      });
    }
  }
}

async function main() {
  await ensureRewards();
  const rules = await prisma.rewardRule.findMany({ where: { isActive: true }, orderBy: { streakDay: 'asc' } });

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, isActive: true, role: UserRole.MEMBER },
    create: {
      email: EMAIL,
      passwordHash,
      fullName: 'Test Vòng Quay',
      role: UserRole.MEMBER,
      dateOfBirth: new Date('2000-01-01'),
      emailVerifiedAt: new Date(),
    },
  });
  const wallet = await prisma.coinWallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  const today = businessDay();
  await prisma.$transaction(async (tx) => {
    // Spins go with their check-in (cascade), so clearing the check-ins clears both.
    await tx.dailyCheckIn.deleteMany({ where: { userId: user.id } });
    for (let streakDay = 1; streakDay <= STREAK_DAYS; streakDay++) {
      const rule = rules.find((candidate) => candidate.streakDay === streakDay);
      const checkIn = await tx.dailyCheckIn.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          checkInDate: new Date(today.getTime() - (STREAK_DAYS - streakDay + 1) * DAY_MS),
          streakDay,
          streakContinued: streakDay > 1,
          bonusGranted: rule?.bonusCoins ?? 0,
          ruleId: rule?.id ?? null,
        },
      });
      // Spins the account already earned and has not used yet.
      if (streakDay <= WAITING_SPINS) {
        await tx.rewardSpin.create({
          data: { userId: user.id, checkInId: checkIn.id, status: RewardSpinStatus.AVAILABLE },
        });
      }
    }
  });

  console.log(
    `Test member ${EMAIL} / ${PASSWORD}: streak ${STREAK_DAYS} ending yesterday (today's check-in is day 7), ${WAITING_SPINS} spins waiting.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
