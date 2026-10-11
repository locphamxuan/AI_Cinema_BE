-- MF-2 round 2 (2026-10-11):
--   * No whole-series purchase (BR-01): the monthly plan is how a member watches a whole movie.
--     series_accesses, movies.series_coin_price and the SERIES_* enum values go away.
--   * Check-in pays bonus Coins only (BR-05): reward_rules.coins is folded into bonus_coins.
--     daily_check_ins.coins_granted is dropped; earlier main-Coin rewards stay in coin_transactions.
--   * Reward spin on the milestone day (BR-09): reward_prizes, reward_spins, subscriptions.source.

-- Guard: the series feature was never priced through the API, so nothing may have used it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "series_accesses")
     OR EXISTS (SELECT 1 FROM "coin_transactions" WHERE "entry_type"::text = 'SERIES_PURCHASE' OR "reference_type"::text = 'SERIES_ACCESS') THEN
    RAISE EXCEPTION 'Series purchases exist: refund them before removing the feature';
  END IF;
END $$;

-- Check-in rewards become bonus Coins only; day 7 is the milestone that grants a spin.
UPDATE "reward_rules" SET "bonus_coins" = "bonus_coins" + "coins";

-- DropTable (before the enums: its column still uses AccessSource)
DROP TABLE "series_accesses";

-- CreateEnum
CREATE TYPE "RewardPrizeType" AS ENUM ('BONUS_COIN', 'PLAN_DAYS');

-- CreateEnum
CREATE TYPE "RewardSpinStatus" AS ENUM ('AVAILABLE', 'USED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('PURCHASE', 'REWARD');

-- AlterEnum
BEGIN;
CREATE TYPE "AccessSource_new" AS ENUM ('EPISODE_PURCHASE', 'FREE_STARTER', 'ADMIN_GRANT');
ALTER TABLE "episode_accesses" ALTER COLUMN "source" TYPE "AccessSource_new" USING ("source"::text::"AccessSource_new");
ALTER TYPE "AccessSource" RENAME TO "AccessSource_old";
ALTER TYPE "AccessSource_new" RENAME TO "AccessSource";
DROP TYPE "public"."AccessSource_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "CoinEntryType_new" AS ENUM ('TOP_UP', 'SIGNUP_BONUS', 'DAILY_REWARD', 'EPISODE_PURCHASE', 'REWARD_SPIN', 'PLAN_PAYMENT', 'PLAN_RENEWAL', 'REFUND', 'BONUS_EXPIRY', 'ADJUSTMENT');
ALTER TABLE "coin_transactions" ALTER COLUMN "entry_type" TYPE "CoinEntryType_new" USING ("entry_type"::text::"CoinEntryType_new");
ALTER TYPE "CoinEntryType" RENAME TO "CoinEntryType_old";
ALTER TYPE "CoinEntryType_new" RENAME TO "CoinEntryType";
DROP TYPE "public"."CoinEntryType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "CoinLotSource" ADD VALUE 'REWARD_SPIN';

-- AlterEnum
BEGIN;
CREATE TYPE "CoinReferenceType_new" AS ENUM ('EPISODE_ACCESS', 'REWARD_SPIN', 'SUBSCRIPTION_CYCLE', 'COIN_TOP_UP', 'DAILY_CHECK_IN', 'ADMIN');
ALTER TABLE "coin_transactions" ALTER COLUMN "reference_type" TYPE "CoinReferenceType_new" USING ("reference_type"::text::"CoinReferenceType_new");
ALTER TYPE "CoinReferenceType" RENAME TO "CoinReferenceType_old";
ALTER TYPE "CoinReferenceType_new" RENAME TO "CoinReferenceType";
DROP TYPE "public"."CoinReferenceType_old";
COMMIT;

-- AlterTable
ALTER TABLE "daily_check_ins" DROP COLUMN "coins_granted",
ALTER COLUMN "bonus_granted" DROP DEFAULT;

-- AlterTable
ALTER TABLE "movies" DROP COLUMN "series_coin_price";

-- AlterTable
ALTER TABLE "reward_rules" DROP COLUMN "coins",
ADD COLUMN     "grants_spin" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "bonus_coins" DROP DEFAULT;

UPDATE "reward_rules" SET "grants_spin" = true WHERE "streak_day" = 7;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "source" "SubscriptionSource" NOT NULL DEFAULT 'PURCHASE';

-- CreateTable
CREATE TABLE "reward_prizes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "RewardPrizeType" NOT NULL,
    "bonus_coins" INTEGER,
    "plan_days" INTEGER,
    "weight" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reward_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_spins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "status" "RewardSpinStatus" NOT NULL DEFAULT 'AVAILABLE',
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spun_at" TIMESTAMPTZ(6),
    "prize_id" UUID,
    "prize_type" "RewardPrizeType",
    "bonus_coins" INTEGER,
    "plan_days" INTEGER,
    "promo_value_coins" INTEGER,
    "coin_transaction_id" UUID,
    "subscription_id" UUID,
    "idempotency_key" VARCHAR(100),

    CONSTRAINT "reward_spins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_prizes_code_key" ON "reward_prizes"("code");

-- CreateIndex
CREATE INDEX "reward_prizes_is_active_idx" ON "reward_prizes"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "reward_spins_check_in_id_key" ON "reward_spins"("check_in_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_spins_coin_transaction_id_key" ON "reward_spins"("coin_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_spins_idempotency_key_key" ON "reward_spins"("idempotency_key");

-- CreateIndex
CREATE INDEX "reward_spins_user_id_status_idx" ON "reward_spins"("user_id", "status");

-- AddForeignKey
ALTER TABLE "reward_prizes" ADD CONSTRAINT "reward_prizes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "daily_check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "reward_prizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECKs (Prisma does not model them; keep them when generating later migrations).
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_bonus_coins_check" CHECK ("bonus_coins" >= 0);
ALTER TABLE "reward_prizes" ADD CONSTRAINT "reward_prizes_weight_check" CHECK ("weight" > 0);
ALTER TABLE "reward_prizes" ADD CONSTRAINT "reward_prizes_type_check" CHECK (
  ("type" = 'BONUS_COIN' AND "bonus_coins" > 0 AND "plan_days" IS NULL)
  OR ("type" = 'PLAN_DAYS' AND "plan_days" > 0 AND "bonus_coins" IS NULL)
);
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_used_check" CHECK (
  "status" = 'AVAILABLE' OR ("prize_id" IS NOT NULL AND "prize_type" IS NOT NULL AND "spun_at" IS NOT NULL)
);
