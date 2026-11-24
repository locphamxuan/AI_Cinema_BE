-- One Coin payment = one group of ledger rows (24/11/2026).
-- A purchase writes a first row for the main Coins and one row per bonus lot it emptied. Every row of
-- that payment now carries payment_id = the id of the first row, so a refund (Admin or system) pays
-- the whole payment back exactly once. Written by hand: the CHECK, the partial unique index and the
-- backfill are not modelled by Prisma - keep them when generating later migrations.
-- Safe to run again: every step is guarded and the backfill only fills rows that are still NULL.

-- 1. The column, its foreign key and indexes.
ALTER TABLE "coin_transactions" ADD COLUMN IF NOT EXISTS "payment_id" UUID;
CREATE INDEX IF NOT EXISTS "coin_transactions_payment_id_idx" ON "coin_transactions"("payment_id");
CREATE INDEX IF NOT EXISTS "coin_transactions_reverses_id_idx" ON "coin_transactions"("reverses_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coin_transactions_payment_id_fkey') THEN
    ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "coin_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Backfill the first row of every earlier payment: the row without a lot (the main part, possibly 0).
UPDATE "coin_transactions"
SET "payment_id" = "id"
WHERE "payment_id" IS NULL
  AND "entry_type" IN ('EPISODE_PURCHASE', 'PLAN_PAYMENT', 'PLAN_RENEWAL')
  AND "lot_id" IS NULL
  AND "main_amount" <= 0 AND "bonus_amount" <= 0;

-- 3. Backfill the lot rows. A payment wrote all its rows in one statement under the wallet lock, so the
-- first row of a lot row is the latest first row of the same wallet and entry type written at or before
-- it (and less than a minute before), and it left the main balance where the lot row shows it. A lot row
-- with two such candidates (same timestamp) is ambiguous and stays NULL: it can then only be refunded
-- through its first row (the code refuses it alone), and the price kept on the EpisodeAccess or the
-- SubscriptionCycle still pays back the whole bonus part.
WITH "candidates" AS (
  SELECT lot."id" AS "row_id",
         head."id" AS "head_id",
         head."main_balance_after" = lot."main_balance_after" AS "same_main",
         rank() OVER (PARTITION BY lot."id" ORDER BY head."created_at" DESC) AS "nearness"
  FROM "coin_transactions" lot
  JOIN "coin_transactions" head
    ON head."wallet_id" = lot."wallet_id"
   AND head."entry_type" = lot."entry_type"
   AND head."payment_id" = head."id"
   AND head."lot_id" IS NULL
   AND head."created_at" <= lot."created_at"
   AND head."created_at" > lot."created_at" - INTERVAL '1 minute'
  WHERE lot."payment_id" IS NULL
    AND lot."entry_type" IN ('EPISODE_PURCHASE', 'PLAN_PAYMENT', 'PLAN_RENEWAL')
    AND lot."lot_id" IS NOT NULL
    AND lot."main_amount" = 0 AND lot."bonus_amount" < 0
), "nearest" AS (
  SELECT "row_id", min("head_id"::text)::uuid AS "head_id", count(*) AS "heads", bool_and("same_main") AS "same_main"
  FROM "candidates"
  WHERE "nearness" = 1
  GROUP BY "row_id"
)
UPDATE "coin_transactions" t
SET "payment_id" = n."head_id"
FROM "nearest" n
WHERE t."id" = n."row_id" AND n."heads" = 1 AND n."same_main";

DO $$
DECLARE unlinked integer;
BEGIN
  SELECT count(*) INTO unlinked FROM "coin_transactions"
  WHERE "payment_id" IS NULL AND "lot_id" IS NOT NULL AND "bonus_amount" < 0
    AND "entry_type" IN ('EPISODE_PURCHASE', 'PLAN_PAYMENT', 'PLAN_RENEWAL');
  IF unlinked > 0 THEN
    RAISE WARNING 'coin_payment_groups: % bonus lot row(s) could not be linked to their payment', unlinked;
  END IF;
END $$;

-- 4. Only a debit of a Coin payment belongs to a payment group.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coin_transactions_payment_debit_check') THEN
    ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_payment_debit_check" CHECK (
      "payment_id" IS NULL
      OR ("entry_type" IN ('EPISODE_PURCHASE', 'PLAN_PAYMENT', 'PLAN_RENEWAL')
          AND "main_amount" <= 0 AND "bonus_amount" <= 0)
    );
  END IF;
END $$;

-- 5. A payment is refunded once: at most one REFUND row may point back at the same entry. The ledger is
-- append-only, so a payment an older build refunded twice keeps both rows; in that case the index only
-- covers the refunds written after the latest such duplicate (a WARNING names how many there were).
DO $$
DECLARE
  duplicates integer;
  latest timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'coin_transactions_one_refund_per_payment') THEN
    RETURN;
  END IF;
  SELECT count(*), max("last_at") INTO duplicates, latest FROM (
    SELECT "reverses_id", max("created_at") AS "last_at" FROM "coin_transactions"
    WHERE "entry_type" = 'REFUND' AND "reverses_id" IS NOT NULL
    GROUP BY "reverses_id" HAVING count(*) > 1
  ) d;
  IF duplicates = 0 THEN
    CREATE UNIQUE INDEX "coin_transactions_one_refund_per_payment" ON "coin_transactions"("reverses_id")
      WHERE "entry_type" = 'REFUND';
  ELSE
    RAISE WARNING 'coin_payment_groups: % payment(s) were refunded more than once before this migration', duplicates;
    EXECUTE format(
      'CREATE UNIQUE INDEX "coin_transactions_one_refund_per_payment" ON "coin_transactions"("reverses_id") '
      'WHERE "entry_type" = ''REFUND'' AND "created_at" > %L::timestamptz',
      latest
    );
  END IF;
END $$;

-- 6. A plan cycle the Admin refunded stops counting as plan revenue.
ALTER TYPE "CycleStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
