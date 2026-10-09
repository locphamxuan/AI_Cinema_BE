/**
 * Ensures the single `platform_settings` row (id = 'default') exists with the
 * development baseline. Idempotent: an existing row is left untouched, so values
 * an Admin changed through the API are never overwritten by re-seeding.
 * Run with `npm run seed:platform-setting` (needs DATABASE_URL).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Mirrors the column defaults in `prisma/schema/platform_setting.prisma`. */
const PLATFORM_SETTING_SEED = {
  id: 'default',
  // BR-03: first episodes of every movie Guests and Free members watch.
  freeStarterEpisodeCount: 2,
  // BR-45: VND value of one Token (production fee) and of one main Coin (revenue).
  tokenRateVnd: 1000,
  coinRateVnd: 1000,
  // BR-47: valid Coin price of one episode; outside it alerts the Admin.
  episodeCoinPriceMin: 1,
  episodeCoinPriceMax: 50,
  // BR-28, BR-52: days a bonus Coin lot stays usable.
  bonusCoinExpiryDays: 30,
  // BR-36: seconds without a heartbeat before a playback session times out.
  playbackHeartbeatTimeoutSeconds: 90,
  // Hours before the renewal date a member may still stop auto-renew.
  subscriptionCancelWindowHours: 24,
  // Hours auto-renew keeps retrying a cycle the wallet could not cover.
  planRenewalGraceHours: 48,
  // Bonus Coins a new account is given; 0 = none.
  newMemberBonusCoins: 0,
  // VND a single top-up has to be between.
  coinTopUpMinVnd: 10000,
  coinTopUpMaxVnd: 2000000,
  // A purchase of an episode taken down for good is refunded in main Coins.
  refundOnRemoval: true,
};

async function main() {
  const existing = await prisma.platformSetting.findUnique({ where: { id: 'default' }, select: { id: true } });
  if (existing) {
    console.log('Platform settings: row `default` already exists; left untouched.');
    return;
  }
  await prisma.platformSetting.create({ data: PLATFORM_SETTING_SEED });
  console.log('Platform settings: row `default` created with the development baseline.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
