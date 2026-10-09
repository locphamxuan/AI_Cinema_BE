-- CreateEnum
CREATE TYPE "CoinLotSource" AS ENUM ('TOP_UP_PROMO', 'SIGNUP_BONUS', 'DAILY_REWARD', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('VNPAY', 'MOMO');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CoinEntryType" AS ENUM ('TOP_UP', 'SIGNUP_BONUS', 'DAILY_REWARD', 'EPISODE_PURCHASE', 'SERIES_PURCHASE', 'PLAN_PAYMENT', 'PLAN_RENEWAL', 'REFUND', 'BONUS_EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CoinReferenceType" AS ENUM ('EPISODE_ACCESS', 'SERIES_ACCESS', 'SUBSCRIPTION_CYCLE', 'COIN_TOP_UP', 'DAILY_CHECK_IN', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccessSource" AS ENUM ('EPISODE_PURCHASE', 'SERIES_PURCHASE', 'FREE_STARTER', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "PlanPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionEndReason" AS ENUM ('CANCELLED_BY_MEMBER', 'CANCELLED_BY_ADMIN', 'PAYMENT_FAILED', 'NOT_RENEWED');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PAID', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "movies" ADD COLUMN     "series_coin_price" INTEGER;

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "coin_top_up_max_vnd" INTEGER NOT NULL DEFAULT 2000000,
ADD COLUMN     "coin_top_up_min_vnd" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "new_member_bonus_coins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plan_renewal_grace_hours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "refund_on_removal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subscription_cancel_window_hours" INTEGER NOT NULL DEFAULT 24;

-- CreateTable
CREATE TABLE "coin_lots" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "source" "CoinLotSource" NOT NULL,
    "original_amount" INTEGER NOT NULL,
    "remaining_amount" INTEGER NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "coin_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_top_ups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "coins_granted" INTEGER NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "provider_txn_id" VARCHAR(100),
    "provider_payment_id" VARCHAR(100),
    "redirect_url" VARCHAR(1000),
    "coin_transaction_id" UUID,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coin_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "entry_type" "CoinEntryType" NOT NULL,
    "main_amount" INTEGER NOT NULL,
    "bonus_amount" INTEGER NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "lot_id" UUID,
    "reference_type" "CoinReferenceType",
    "reference_id" UUID,
    "reverses_id" UUID,
    "idempotency_key" VARCHAR(100),
    "main_balance_after" INTEGER NOT NULL,
    "bonus_balance_after" INTEGER NOT NULL,
    "description" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "main_balance" INTEGER NOT NULL DEFAULT 0,
    "bonus_balance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_check_ins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "check_in_date" DATE NOT NULL,
    "streak_day" INTEGER NOT NULL,
    "streak_continued" BOOLEAN NOT NULL,
    "coins_granted" INTEGER NOT NULL,
    "bonus_granted" INTEGER NOT NULL DEFAULT 0,
    "coin_transaction_id" UUID,
    "rule_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_accesses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "source" "AccessSource" NOT NULL,
    "paid_coins" INTEGER NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "coin_transaction_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,

    CONSTRAINT "episode_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "period" "PlanPeriod" NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "is_free" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "price_coins" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_callbacks" (
    "id" UUID NOT NULL,
    "top_up_id" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "event_id" VARCHAR(150) NOT NULL,
    "signature" VARCHAR(255),
    "payload" JSONB NOT NULL,
    "handled_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_rules" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "streak_day" INTEGER NOT NULL,
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reward_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_accesses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "source" "AccessSource" NOT NULL DEFAULT 'SERIES_PURCHASE',
    "paid_coins" INTEGER NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "coin_transaction_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,

    CONSTRAINT "series_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "price_coins" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "next_renewal_at" TIMESTAMPTZ(6),
    "cancel_requested_at" TIMESTAMPTZ(6),
    "cancel_window_ends_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" "SubscriptionEndReason",
    "renewals_completed" INTEGER NOT NULL DEFAULT 0,
    "last_renewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cycles" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "price_coins" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL,
    "main_coins_charged" INTEGER NOT NULL DEFAULT 0,
    "bonus_coins_charged" INTEGER NOT NULL DEFAULT 0,
    "coin_transaction_id" UUID,
    "failure_reason" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coin_lots_wallet_id_expires_at_idx" ON "coin_lots"("wallet_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "coin_top_ups_coin_transaction_id_key" ON "coin_top_ups"("coin_transaction_id");

-- CreateIndex
CREATE INDEX "coin_top_ups_user_id_created_at_idx" ON "coin_top_ups"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "coin_top_ups_status_expires_at_idx" ON "coin_top_ups"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "coin_top_ups_provider_provider_txn_id_key" ON "coin_top_ups"("provider", "provider_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "coin_transactions_idempotency_key_key" ON "coin_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "coin_transactions_wallet_id_created_at_idx" ON "coin_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "coin_transactions_reference_type_reference_id_idx" ON "coin_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "coin_transactions_entry_type_created_at_idx" ON "coin_transactions"("entry_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "coin_wallets_user_id_key" ON "coin_wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_check_ins_coin_transaction_id_key" ON "daily_check_ins"("coin_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_check_ins_user_id_check_in_date_key" ON "daily_check_ins"("user_id", "check_in_date");

-- CreateIndex
CREATE UNIQUE INDEX "episode_accesses_coin_transaction_id_key" ON "episode_accesses"("coin_transaction_id");

-- CreateIndex
CREATE INDEX "episode_accesses_user_id_episode_id_idx" ON "episode_accesses"("user_id", "episode_id");

-- CreateIndex
CREATE INDEX "episode_accesses_episode_id_idx" ON "episode_accesses"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_code_key" ON "membership_plans"("code");

-- CreateIndex
CREATE INDEX "membership_plans_is_active_sort_order_idx" ON "membership_plans"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "membership_plan_prices_plan_id_effective_from_idx" ON "membership_plan_prices"("plan_id", "effective_from");

-- CreateIndex
CREATE INDEX "payment_callbacks_top_up_id_idx" ON "payment_callbacks"("top_up_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_callbacks_provider_event_id_key" ON "payment_callbacks"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_rules_code_key" ON "reward_rules"("code");

-- CreateIndex
CREATE INDEX "reward_rules_is_active_streak_day_idx" ON "reward_rules"("is_active", "streak_day");

-- CreateIndex
CREATE UNIQUE INDEX "series_accesses_coin_transaction_id_key" ON "series_accesses"("coin_transaction_id");

-- CreateIndex
CREATE INDEX "series_accesses_user_id_movie_id_idx" ON "series_accesses"("user_id", "movie_id");

-- CreateIndex
CREATE INDEX "series_accesses_movie_id_idx" ON "series_accesses"("movie_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_next_renewal_at_idx" ON "subscriptions"("status", "next_renewal_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycles_coin_transaction_id_key" ON "subscription_cycles"("coin_transaction_id");

-- CreateIndex
CREATE INDEX "subscription_cycles_status_attempted_at_idx" ON "subscription_cycles"("status", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycles_subscription_id_cycle_number_key" ON "subscription_cycles"("subscription_id", "cycle_number");

-- AddForeignKey
ALTER TABLE "coin_lots" ADD CONSTRAINT "coin_lots_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "coin_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_top_ups" ADD CONSTRAINT "coin_top_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_top_ups" ADD CONSTRAINT "coin_top_ups_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "coin_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_top_ups" ADD CONSTRAINT "coin_top_ups_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "coin_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "coin_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "coin_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "reward_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_accesses" ADD CONSTRAINT "episode_accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_accesses" ADD CONSTRAINT "episode_accesses_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_accesses" ADD CONSTRAINT "episode_accesses_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plan_prices" ADD CONSTRAINT "membership_plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plan_prices" ADD CONSTRAINT "membership_plan_prices_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_top_up_id_fkey" FOREIGN KEY ("top_up_id") REFERENCES "coin_top_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_accesses" ADD CONSTRAINT "series_accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_accesses" ADD CONSTRAINT "series_accesses_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_accesses" ADD CONSTRAINT "series_accesses_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycles" ADD CONSTRAINT "subscription_cycles_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
