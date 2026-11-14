-- 2026-11-14: BR-48 Monthly-plan revenue shared by watch time, and Coin transactions flagged by the risk rules (Admin only).
-- CreateEnum
CREATE TYPE "TransactionFlagStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "revenue_allocations" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "movie_id" UUID NOT NULL,
    "movie_watch_seconds" BIGINT NOT NULL,
    "total_watch_seconds" BIGINT NOT NULL,
    "monthly_pool_vnd" BIGINT NOT NULL,
    "allocated_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_flags" (
    "id" UUID NOT NULL,
    "coin_transaction_id" UUID NOT NULL,
    "rule_code" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TransactionFlagStatus" NOT NULL DEFAULT 'OPEN',
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_allocations_movie_id_idx" ON "revenue_allocations"("movie_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_allocations_period_movie_id_key" ON "revenue_allocations"("period", "movie_id");

-- CreateIndex
CREATE INDEX "transaction_flags_status_created_at_idx" ON "transaction_flags"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_flags_rule_code_coin_transaction_id_key" ON "transaction_flags"("rule_code", "coin_transaction_id");

-- AddForeignKey
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_flags" ADD CONSTRAINT "transaction_flags_coin_transaction_id_fkey" FOREIGN KEY ("coin_transaction_id") REFERENCES "coin_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_flags" ADD CONSTRAINT "transaction_flags_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Admin-only permissions on databases seeded earlier (the seed covers new ones).
INSERT INTO "permissions" ("key", "area", "description") VALUES
    ('finance:report.read', 'finance', 'Read profit, ROI and the Monthly-plan revenue shared per movie'),
    ('finance:allocation.run', 'finance', 'Share a past month''s Monthly-plan revenue across movies again'),
    ('risk:flag.manage', 'finance', 'Scan the Coin ledger and confirm or dismiss risky transactions')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN'::"UserRole", grant_key FROM (VALUES
    ('finance:report.read'), ('finance:allocation.run'), ('risk:flag.manage')
) AS g(grant_key)
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;
