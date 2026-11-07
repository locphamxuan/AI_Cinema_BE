-- Contract negotiation (2026-11-07): MF-1 pivot — a studio hand-off no longer agrees its fee outside the
-- system. The system sends a template contract (no cost) to the studio; the studio fills it in and signs;
-- Admin and the studio counter-propose a new cost each round until one round carries both signatures.
-- Hand-written against the shared dev database (not `prisma migrate dev`) because that database already had
-- an unrelated drift on "ads"; the CHECKs and permission seed below are invisible to `prisma migrate diff`.

-- CreateEnum
CREATE TYPE "ContractProposedBy" AS ENUM ('ADMIN', 'STUDIO');
CREATE TYPE "ContractStatus" AS ENUM ('SENT', 'STUDIO_SIGNED', 'ADMIN_COUNTERED', 'SIGNED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "previous_id" UUID,
    "cost_vnd" BIGINT,
    "proposed_by" "ContractProposedBy",
    "status" "ContractStatus" NOT NULL DEFAULT 'SENT',
    "terms" TEXT NOT NULL,
    "admin_signed_at" TIMESTAMPTZ(6),
    "admin_signed_by_id" UUID,
    "studio_signed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_previous_id_key" ON "contracts"("previous_id");
CREATE INDEX "contracts_project_id_created_at_idx" ON "contracts"("project_id", "created_at");
CREATE INDEX "contracts_handoff_id_round_idx" ON "contracts"("handoff_id", "round");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_handoff_id_fkey" FOREIGN KEY ("handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_id_fkey" FOREIGN KEY ("previous_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_admin_signed_by_id_fkey" FOREIGN KEY ("admin_signed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs ---------------------------------------------------------------------------------------------------
ALTER TABLE "contracts"
    ADD CONSTRAINT "contracts_cost_check" CHECK ("cost_vnd" IS NULL OR ("cost_vnd" > 0 AND "cost_vnd" % 1000 = 0)),
    ADD CONSTRAINT "contracts_round_check" CHECK ("round" > 0),
    ADD CONSTRAINT "contracts_proposal_check" CHECK (("cost_vnd" IS NULL) = ("proposed_by" IS NULL)),
    ADD CONSTRAINT "contracts_admin_sign_check" CHECK (("admin_signed_at" IS NULL) = ("admin_signed_by_id" IS NULL)),
    ADD CONSTRAINT "contracts_status_check" CHECK (
        ("status" = 'SENT' AND "cost_vnd" IS NULL AND "admin_signed_at" IS NULL AND "studio_signed_at" IS NULL)
        OR ("status" = 'STUDIO_SIGNED' AND "cost_vnd" IS NOT NULL AND "studio_signed_at" IS NOT NULL AND "admin_signed_at" IS NULL)
        OR ("status" = 'ADMIN_COUNTERED' AND "cost_vnd" IS NOT NULL AND "admin_signed_at" IS NOT NULL AND "studio_signed_at" IS NULL)
        OR ("status" = 'SIGNED' AND "cost_vnd" IS NOT NULL AND "admin_signed_at" IS NOT NULL AND "studio_signed_at" IS NOT NULL)
        OR "status" = 'SUPERSEDED');

-- Permissions ------------------------------------------------------------------------------------------------
-- Admin sends the template, signs or counter-proposes; the seed only fills a role that has none yet.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'contract:manage', 'movie-project', 'Send the studio a contract template, sign it or counter-propose its cost'
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'contract:manage'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;
