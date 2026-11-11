-- MF-1 governance (07/11/2026, `MF1 chỉnh sửa.txt`): the Admin creates the project and assigns the Creator; the
-- Creator writes the script, the Reviewer then the Admin approve it (Final Script); the system then sends the
-- studio a contract template, and the signed contract hands the project off; the studio logs in to negotiate
-- and deliver; the Reviewer confirms the Final Film and the Admin publishes it.
-- Hand-written: the backfill, CHECKs and permission seed below are invisible to `prisma migrate diff`.

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('SUBMITTED', 'REVIEWER_APPROVED', 'REVISION_REQUESTED', 'FINAL');
CREATE TYPE "ScriptReviewStage" AS ENUM ('REVIEWER', 'ADMIN');

-- Studio accounts -------------------------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "studio_id" UUID;
CREATE INDEX "users_studio_id_idx" ON "users"("studio_id");
ALTER TABLE "users" ADD CONSTRAINT "users_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A STUDIO account always speaks for one studio, and only a STUDIO account does.
ALTER TABLE "users" ADD CONSTRAINT "users_studio_role_check" CHECK (("role" = 'STUDIO') = ("studio_id" IS NOT NULL));

-- Contracts: negotiated with the project's studio before any hand-off exists ----------------------------------
ALTER TABLE "contracts" ADD COLUMN "studio_id" UUID;
UPDATE "contracts" c SET "studio_id" = h."studio_id" FROM "studio_handoffs" h WHERE h."id" = c."handoff_id";
ALTER TABLE "contracts" ALTER COLUMN "studio_id" SET NOT NULL;
ALTER TABLE "contracts" ALTER COLUMN "handoff_id" DROP NOT NULL;
CREATE INDEX "contracts_studio_id_status_idx" ON "contracts"("studio_id", "status");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Final Film confirmation -------------------------------------------------------------------------------------
ALTER TABLE "episodes"
    ADD COLUMN "final_confirmed_at" TIMESTAMPTZ(6),
    ADD COLUMN "final_confirmed_by_id" UUID,
    ADD COLUMN "final_rejection_note" TEXT;
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_final_confirmed_by_id_fkey" FOREIGN KEY ("final_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_final_confirmation_check"
    CHECK ("final_confirmed_at" IS NULL OR "final_confirmed_by_id" IS NOT NULL);

-- Scripts -----------------------------------------------------------------------------------------------------
CREATE TABLE "project_scripts" (
    "project_id" UUID NOT NULL,
    "status" "ScriptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "current_version" INTEGER NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "project_scripts_pkey" PRIMARY KEY ("project_id")
);
CREATE TABLE "script_versions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "submitted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "script_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "script_reviews" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "stage" "ScriptReviewStage" NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "comment" TEXT,
    "reviewer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "script_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "script_versions_project_id_version_key" ON "script_versions"("project_id", "version");
CREATE INDEX "script_reviews_project_id_created_at_idx" ON "script_reviews"("project_id", "created_at");
ALTER TABLE "project_scripts" ADD CONSTRAINT "project_scripts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_scripts"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_scripts"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_scripts"
    ADD CONSTRAINT "project_scripts_version_check" CHECK ("current_version" > 0),
    ADD CONSTRAINT "project_scripts_final_check" CHECK (("status" = 'FINAL') = ("finalized_at" IS NOT NULL));
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_version_check" CHECK ("version" > 0);
-- A version sent back always says why.
ALTER TABLE "script_reviews" ADD CONSTRAINT "script_reviews_comment_check"
    CHECK ("approved" OR ("comment" IS NOT NULL AND btrim("comment") <> ''));

-- Permissions -------------------------------------------------------------------------------------------------
-- New keys; the seed only fills a role that has none yet, so an existing database is granted them here.
INSERT INTO "permissions" ("key", "area", "description")
SELECT v.key, v.area, v.description FROM (VALUES
    ('project:create', 'movie-project', 'Create a movie project, pick its Reviewer, Creator and studio, reassign the Creator'),
    ('script:write', 'movie-project', 'Write and submit the script of an assigned project'),
    ('script:approve', 'movie-project', 'Approve the Final Script (the system then sends the studio its contract) or send it back'),
    ('studio:portal', 'studio', 'Studio account: negotiate and sign its contracts, read its projects, deliver films'),
    ('episode:price', 'publishing', 'Set the Coin price of an episode before confirming the Final Film')
) AS v(key, area, description)
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("key") DO NOTHING;

UPDATE "permissions" SET "description" = 'Publish, schedule and unpublish episodes once the Reviewer confirmed the Final Film'
WHERE "key" = 'episode:publish';

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT v.role::"UserRole", v.key FROM (VALUES
    ('ADMIN', 'project:create'),
    ('ADMIN', 'script:approve'),
    ('ADMIN', 'episode:publish'),
    ('ADMIN', 'studio:manage'),
    ('CONTENT_CREATOR', 'script:write'),
    ('CONTENT_REVIEWER', 'episode:price'),
    ('STUDIO', 'studio:portal')
) AS v(role, key)
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT DO NOTHING;

-- Only the Admin publishes now; the Reviewer confirms the Final Film instead.
DELETE FROM "role_permissions" WHERE "role" = 'CONTENT_REVIEWER' AND "permission_key" = 'episode:publish';
