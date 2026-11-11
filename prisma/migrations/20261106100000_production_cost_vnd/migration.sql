-- Production cost in VND (2026-11-06): the Token unit, its rate and the Reviewer Token budget are gone.
-- The Admin sets a project's budget in VND (production_cost_entries); a studio is paid a fixed agreed fee
-- outside the platform; when a studio asks for more than the budget left, the Reviewer asks the Admin
-- (production_cost_requests). Token amounts are converted at the rate each row was written at, or at the
-- current token_rate_vnd where a row kept none, rounded to whole thousands of VND.
-- Hand-written: the backfill and the CHECKs below are invisible to `prisma migrate diff`.

-- CreateEnum
CREATE TYPE "ProductionCostEntryType" AS ENUM ('BUDGET', 'ADDITIONAL', 'CORRECTION');
CREATE TYPE "CostRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "production_cost_entries" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entry_type" "ProductionCostEntryType" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "reason" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_cost_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "production_cost_requests" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "handoff_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "studio_quote_vnd" BIGINT,
    "requested_vnd" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "attachment_name" VARCHAR(255),
    "attachment_key" VARCHAR(500),
    "attachment_mime_type" VARCHAR(100),
    "status" "CostRequestStatus" NOT NULL DEFAULT 'OPEN',
    "granted_vnd" BIGINT,
    "admin_response" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_cost_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_cost_entries_request_id_key" ON "production_cost_entries"("request_id");
CREATE INDEX "production_cost_entries_project_id_created_at_idx" ON "production_cost_entries"("project_id", "created_at");
CREATE INDEX "production_cost_requests_project_id_status_idx" ON "production_cost_requests"("project_id", "status");
CREATE INDEX "production_cost_requests_status_created_at_idx" ON "production_cost_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "production_cost_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_requests" ADD CONSTRAINT "production_cost_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_cost_requests" ADD CONSTRAINT "production_cost_requests_handoff_id_fkey" FOREIGN KEY ("handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_cost_requests" ADD CONSTRAINT "production_cost_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_requests" ADD CONSTRAINT "production_cost_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill ------------------------------------------------------------------------------------------------
-- Whole thousands of VND, at least 1,000 for a positive amount.
CREATE FUNCTION pg_temp.vnd(tokens BIGINT, rate BIGINT) RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN tokens * rate > 0 THEN GREATEST(1000, ROUND(tokens * rate / 1000.0) * 1000)
                ELSE ROUND(tokens * rate / 1000.0) * 1000 END::BIGINT
$$;
-- The rate a project's fee was booked at (weighted over its ledger), else the current one: a hand-off and a
-- request are converted like the budget they draw on, so what was committed still fits in it.
CREATE FUNCTION pg_temp.rate(project UUID) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT ROUND(SUM("amount_tokens" * "rate_vnd")::numeric / NULLIF(SUM("amount_tokens"), 0))
         FROM "token_ledger" WHERE "project_id" = project AND "amount_tokens" > 0),
        (SELECT "token_rate_vnd" FROM "platform_settings" WHERE "id" = 'default'),
        1000)::BIGINT
$$;

-- The project budget: every INITIAL allocation of a project (one per season) becomes one BUDGET entry.
INSERT INTO "production_cost_entries" ("id", "project_id", "entry_type", "amount_vnd", "reason", "created_by_id", "created_at")
SELECT gen_random_uuid(), "project_id", 'BUDGET', SUM(pg_temp.vnd("amount_tokens", "rate_vnd")),
       'Chuyển từ phí sản xuất Token', (ARRAY_AGG("created_by_id" ORDER BY "created_at"))[1], MIN("created_at")
FROM "token_ledger" WHERE "entry_type" = 'INITIAL'
GROUP BY "project_id";

-- Top-ups and corrections keep their own rows and reasons.
INSERT INTO "production_cost_entries" ("id", "project_id", "entry_type", "amount_vnd", "reason", "created_by_id", "created_at")
SELECT gen_random_uuid(), "project_id",
       (CASE WHEN "entry_type" = 'TOP_UP' THEN 'ADDITIONAL' ELSE 'CORRECTION' END)::"ProductionCostEntryType",
       pg_temp.vnd("amount_tokens", "rate_vnd"), COALESCE("reason", 'Chuyển từ phí sản xuất Token'),
       "created_by_id", "created_at"
FROM "token_ledger"
WHERE "entry_type" <> 'INITIAL' AND pg_temp.vnd("amount_tokens", "rate_vnd") <> 0;

-- A project funded only by top-ups still needs its BUDGET row: the first top-up becomes it.
UPDATE "production_cost_entries" e SET "entry_type" = 'BUDGET'
WHERE e."entry_type" = 'ADDITIONAL' AND e."amount_vnd" > 0
  AND NOT EXISTS (SELECT 1 FROM "production_cost_entries" b WHERE b."project_id" = e."project_id" AND b."entry_type" = 'BUDGET')
  AND e."id" = (SELECT f."id" FROM "production_cost_entries" f
                WHERE f."project_id" = e."project_id" AND f."entry_type" = 'ADDITIONAL' AND f."amount_vnd" > 0
                ORDER BY f."created_at", f."id" LIMIT 1);

-- A Creator's request for more Token becomes a cost request (no proof was required then).
INSERT INTO "production_cost_requests" ("id", "project_id", "requested_by_id", "requested_vnd", "reason", "status",
                                        "granted_vnd", "admin_response", "resolved_by_id", "resolved_at", "created_at")
SELECT "id", "project_id", "requested_by_id", pg_temp.vnd("requested_tokens", pg_temp.rate("project_id")), "reason",
       "status"::text::"CostRequestStatus",
       CASE WHEN "granted_tokens" IS NULL THEN NULL
            ELSE LEAST(pg_temp.vnd("granted_tokens", pg_temp.rate("project_id")), pg_temp.vnd("requested_tokens", pg_temp.rate("project_id"))) END,
       "reviewer_response", "resolved_by_id", "resolved_at", "created_at"
FROM "token_requests";

-- Hand-offs: the offered fee and what a replaced studio cost, in VND.
ALTER TABLE "studio_handoffs" ADD COLUMN "offered_fee_vnd" BIGINT, ADD COLUMN "forfeited_vnd" BIGINT NOT NULL DEFAULT 0;
UPDATE "studio_handoffs" SET "offered_fee_vnd" = pg_temp.vnd(GREATEST("production_fee_tokens", 1), pg_temp.rate("project_id"));
UPDATE "studio_handoffs" SET "forfeited_vnd" = LEAST("offered_fee_vnd", pg_temp.vnd("lost_tokens", pg_temp.rate("project_id")));
ALTER TABLE "studio_handoffs" ALTER COLUMN "offered_fee_vnd" SET NOT NULL;

-- A budget supplement asked the Admin for Reviewer Token; it stays as a plain request, its amount in the text.
ALTER TABLE "project_change_requests" DROP CONSTRAINT IF EXISTS "project_change_requests_tokens_check";
UPDATE "project_change_requests"
SET "request_type" = 'OTHER',
    "content" = "content" || E'\n(Xin bổ sung ' || COALESCE("requested_tokens"::text, '?') || ' Token)'
WHERE "request_type" = 'BUDGET_SUPPLEMENT';

-- The Token history is money history: archive every row in audit_logs before the tables go.
INSERT INTO "audit_logs" ("id", "entity_type", "entity_id", "action", "actor_type", "actor_id", "project_id", "payload", "created_at")
SELECT gen_random_uuid(), 'TokenLedgerEntry', "id", 'LEGACY_TOKEN_ARCHIVED', 'SYSTEM', NULL, "project_id",
       to_jsonb(t) - 'id', "created_at"
FROM "token_ledger" t;
INSERT INTO "audit_logs" ("id", "entity_type", "entity_id", "action", "actor_type", "actor_id", "project_id", "payload", "created_at")
SELECT gen_random_uuid(), 'ReviewerTokenEntry', "id", 'LEGACY_TOKEN_ARCHIVED', 'SYSTEM', NULL, NULL,
       to_jsonb(r) - 'id', "created_at"
FROM "reviewer_token_ledger" r;
INSERT INTO "audit_logs" ("id", "entity_type", "entity_id", "action", "actor_type", "actor_id", "project_id", "payload", "created_at")
SELECT gen_random_uuid(), 'StudioHandoff', "id", 'LEGACY_TOKEN_ARCHIVED', 'SYSTEM', NULL, "project_id",
       jsonb_build_object('productionFeeTokens', "production_fee_tokens", 'lostTokens', "lost_tokens"), "created_at"
FROM "studio_handoffs";

-- Drop the Token era -----------------------------------------------------------------------------------------
-- AlterEnum
CREATE TYPE "ChangeRequestType_new" AS ENUM ('PROJECT_UPDATE', 'DEADLINE_EXTENSION', 'OTHER');
ALTER TABLE "project_change_requests" ALTER COLUMN "request_type" DROP DEFAULT;
ALTER TABLE "project_change_requests" ALTER COLUMN "request_type" TYPE "ChangeRequestType_new" USING ("request_type"::text::"ChangeRequestType_new");
ALTER TYPE "ChangeRequestType" RENAME TO "ChangeRequestType_old";
ALTER TYPE "ChangeRequestType_new" RENAME TO "ChangeRequestType";
DROP TYPE "ChangeRequestType_old";
ALTER TABLE "project_change_requests" ALTER COLUMN "request_type" SET DEFAULT 'PROJECT_UPDATE';
ALTER TABLE "project_change_requests" DROP COLUMN "requested_tokens";

-- Columns: their CHECKs (studio_handoffs_fee_check, studio_handoffs_lost_tokens_check, seasons_episode_cost_check,
-- platform_settings_rate_check) go with them.
ALTER TABLE "studio_handoffs" DROP COLUMN "lost_tokens", DROP COLUMN "production_fee_tokens";
ALTER TABLE "seasons" DROP COLUMN "episode_production_cost";
ALTER TABLE "platform_settings" DROP COLUMN "token_rate_vnd";

-- Tables, with their CHECKs (token_ledger_*, token_requests_*, reviewer_token_ledger_sign).
DROP TABLE "reviewer_token_ledger";
DROP TABLE "token_ledger";
DROP TABLE "token_requests";
DROP TYPE "ReviewerTokenEntryType";
DROP TYPE "TokenEntryType";
DROP TYPE "TokenRequestStatus";

-- CHECKs -----------------------------------------------------------------------------------------------------
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_rate_check" CHECK ("coin_rate_vnd" > 0);

ALTER TABLE "production_cost_entries"
    ADD CONSTRAINT "production_cost_entries_amount_check" CHECK (
        "amount_vnd" % 1000 = 0
        AND (("entry_type" IN ('BUDGET', 'ADDITIONAL') AND "amount_vnd" > 0)
             OR ("entry_type" = 'CORRECTION' AND "amount_vnd" <> 0))),
    ADD CONSTRAINT "production_cost_entries_reason_check" CHECK ("entry_type" = 'BUDGET' OR "reason" IS NOT NULL),
    ADD CONSTRAINT "production_cost_entries_request_check" CHECK ("request_id" IS NULL OR "entry_type" = 'ADDITIONAL');

ALTER TABLE "production_cost_requests"
    ADD CONSTRAINT "production_cost_requests_amount_check" CHECK (
        "requested_vnd" > 0 AND "requested_vnd" % 1000 = 0
        AND ("studio_quote_vnd" IS NULL OR ("studio_quote_vnd" > 0 AND "studio_quote_vnd" % 1000 = 0))),
    ADD CONSTRAINT "production_cost_requests_resolution_check" CHECK (
        ("status" = 'OPEN' AND "resolved_at" IS NULL AND "granted_vnd" IS NULL)
        OR ("status" = 'APPROVED' AND "resolved_at" IS NOT NULL AND "granted_vnd" > 0
            AND "granted_vnd" % 1000 = 0 AND "granted_vnd" <= "requested_vnd")
        OR ("status" = 'REJECTED' AND "resolved_at" IS NOT NULL AND "granted_vnd" IS NULL
            AND "admin_response" IS NOT NULL)),
    -- The proof is stored whole or not at all.
    ADD CONSTRAINT "production_cost_requests_attachment_check" CHECK (
        ("attachment_key" IS NULL) = ("attachment_name" IS NULL)
        AND ("attachment_key" IS NULL) = ("attachment_mime_type" IS NULL));

ALTER TABLE "studio_handoffs"
    ADD CONSTRAINT "studio_handoffs_fee_check" CHECK ("offered_fee_vnd" > 0 AND "offered_fee_vnd" % 1000 = 0),
    ADD CONSTRAINT "studio_handoffs_forfeited_check" CHECK (
        "forfeited_vnd" >= 0 AND "forfeited_vnd" % 1000 = 0 AND "forfeited_vnd" <= "offered_fee_vnd"
        AND ("forfeited_vnd" = 0 OR "milestone_status" = 'SUPERSEDED'));

-- Permissions -------------------------------------------------------------------------------------------------
-- The Reviewer asks for more production cost; the Admin decides and adjusts the budget. The seed only fills the
-- matrix of a role that has no permission yet, so an existing database gets the keys here, before the
-- Token keys go (an empty role_permissions = a fresh database, left to the seed).
INSERT INTO "permissions" ("key", "area", "description")
SELECT k, 'movie-project', d
FROM (VALUES
    ('cost:request', 'Ask the Admin for more production cost (VND), with the studio quote as proof'),
    ('cost:approve', 'Grant (in full or in part) or refuse the production cost requests of Reviewers'),
    ('cost:adjust', 'Set the production budget (VND) of a project and correct it')
) AS v(k, d)
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT r::"UserRole", k
FROM (VALUES ('CONTENT_REVIEWER', 'cost:request'), ('ADMIN', 'cost:approve'), ('ADMIN', 'cost:adjust')) AS v(r, k)
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = v.r::"UserRole")
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions" WHERE "permission_key" IN ('project:fee.allocate', 'token-budget:manage');
DELETE FROM "permissions" WHERE "key" IN ('project:fee.allocate', 'token-budget:manage');
