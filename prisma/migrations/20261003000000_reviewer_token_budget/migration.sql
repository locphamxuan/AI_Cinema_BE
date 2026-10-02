-- Reviewer Token budget (2026-10-03): the Admin grants Token to each Reviewer; a Reviewer can only
-- allocate production fees out of what is left.

-- CreateEnum
CREATE TYPE "ReviewerTokenEntryType" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "reviewer_token_ledger" (
    "id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "entry_type" "ReviewerTokenEntryType" NOT NULL,
    "amount_tokens" BIGINT NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviewer_token_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewer_token_ledger_reviewer_id_created_at_idx" ON "reviewer_token_ledger"("reviewer_id", "created_at");

-- AddForeignKey
ALTER TABLE "reviewer_token_ledger" ADD CONSTRAINT "reviewer_token_ledger_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_token_ledger" ADD CONSTRAINT "reviewer_token_ledger_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs are invisible to `prisma migrate diff`, so prisma/schema does not carry them.
ALTER TABLE "reviewer_token_ledger" ADD CONSTRAINT "reviewer_token_ledger_sign"
    CHECK (
        ("entry_type" = 'GRANT' AND "amount_tokens" > 0)
        OR ("entry_type" = 'REVOKE' AND "amount_tokens" < 0 AND "reason" IS NOT NULL)
    );

-- Opening balance: what each Reviewer already allocated before budgets existed, so nobody starts below 0.
INSERT INTO "reviewer_token_ledger" ("id", "reviewer_id", "entry_type", "amount_tokens", "rate_vnd", "reason")
SELECT gen_random_uuid(), "created_by_id", 'GRANT', SUM("amount_tokens"),
       COALESCE((SELECT "token_rate_vnd" FROM "platform_settings" WHERE "id" = 'default'), 1000),
       'Số dư mở đầu: Token đã cấp cho dự án trước khi có ngân sách Token'
FROM "token_ledger"
GROUP BY "created_by_id"
HAVING SUM("amount_tokens") > 0;

-- The Admin manages budgets. The seed only fills the matrix of a role that has no permission yet, so an
-- existing database gets the key here; a fresh one (ADMIN still empty) is left to the seed.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'token-budget:manage', 'administration', 'Grant Token to Reviewers and take back what they have not allocated'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'token-budget:manage'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;
