-- Split the production lifecycle out of `movies` (2026-10-29). `movie_projects` keeps who orders the
-- movie, from which studio and how far it got; `movies` keeps only what the catalog shows. Both rows
-- share one id (1:1), so every existing id stays valid. Production tables now point at the project.
-- CHECKs and triggers below are invisible to `prisma migrate diff`; never drop them in a later migration.

ALTER TYPE "MovieStatus" RENAME TO "ProjectStatus";

-- CreateTable
CREATE TABLE "movie_projects" (
    "id" UUID NOT NULL,
    "idea_description" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewer_id" UUID NOT NULL,
    "creator_id" UUID,
    "studio_id" UUID,
    "cancel_reason" TEXT,
    "handed_off_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "movie_projects_pkey" PRIMARY KEY ("id")
);

INSERT INTO "movie_projects" ("id", "idea_description", "status", "reviewer_id", "creator_id", "studio_id",
    "cancel_reason", "handed_off_at", "completed_at", "cancelled_at", "created_at", "updated_at")
SELECT "id", "idea_description", "status", "reviewer_id", "creator_id", "studio_id",
    "cancel_reason", "handed_off_at", "completed_at", "cancelled_at", "created_at", "updated_at"
FROM "movies";

CREATE INDEX "movie_projects_status_idx" ON "movie_projects"("status");
CREATE INDEX "movie_projects_reviewer_id_idx" ON "movie_projects"("reviewer_id");
CREATE INDEX "movie_projects_creator_id_idx" ON "movie_projects"("creator_id");
CREATE INDEX "movie_projects_studio_id_idx" ON "movie_projects"("studio_id");

ALTER TABLE "movie_projects" ADD CONSTRAINT "movie_projects_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movie_projects" ADD CONSTRAINT "movie_projects_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movie_projects" ADD CONSTRAINT "movie_projects_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movie_projects" ADD CONSTRAINT "movie_projects_id_fkey" FOREIGN KEY ("id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- BR-59: a handed-off project always has its studio (moved from movies_studio_check).
ALTER TABLE "movie_projects" ADD CONSTRAINT "movie_projects_studio_check" CHECK (
    "status" NOT IN ('IN_PRODUCTION', 'COMPLETED', 'UNDER_REVISION') OR "studio_id" IS NOT NULL
);

-- Movies: the catalog face of the project, same id.
ALTER TABLE "movies" DROP CONSTRAINT "movies_studio_check",
DROP CONSTRAINT "movies_reviewer_id_fkey",
DROP CONSTRAINT "movies_creator_id_fkey",
DROP CONSTRAINT "movies_studio_id_fkey";
DROP INDEX "movies_status_idx";
DROP INDEX "movies_reviewer_id_idx";
DROP INDEX "movies_creator_id_idx";
DROP INDEX "movies_studio_id_idx";
ALTER TABLE "movies" DROP COLUMN "idea_description",
DROP COLUMN "status",
DROP COLUMN "reviewer_id",
DROP COLUMN "creator_id",
DROP COLUMN "studio_id",
DROP COLUMN "cancel_reason",
DROP COLUMN "handed_off_at",
DROP COLUMN "completed_at",
DROP COLUMN "cancelled_at";

-- Production tables: movie_id → project_id, pointing at the project.
ALTER TABLE "movie_idea_files" DROP CONSTRAINT "movie_idea_files_movie_id_fkey";
ALTER TABLE "movie_idea_files" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "movie_idea_files_movie_id_file_name_version_key" RENAME TO "movie_idea_files_project_id_file_name_version_key";
ALTER TABLE "movie_idea_files" ADD CONSTRAINT "movie_idea_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_change_requests" DROP CONSTRAINT "project_change_requests_movie_id_fkey";
ALTER TABLE "project_change_requests" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "project_change_requests_movie_id_status_idx" RENAME TO "project_change_requests_project_id_status_idx";
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_creator_assignments" DROP CONSTRAINT "project_creator_assignments_movie_id_fkey";
ALTER TABLE "project_creator_assignments" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "project_creator_assignments_movie_id_is_active_idx" RENAME TO "project_creator_assignments_project_id_is_active_idx";
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_handoffs" DROP CONSTRAINT "studio_handoffs_movie_id_fkey";
ALTER TABLE "studio_handoffs" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "studio_handoffs_movie_id_created_at_idx" RENAME TO "studio_handoffs_project_id_created_at_idx";
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "token_ledger" DROP CONSTRAINT "token_ledger_movie_id_fkey";
ALTER TABLE "token_ledger" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "token_ledger_movie_id_created_at_idx" RENAME TO "token_ledger_project_id_created_at_idx";
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "token_requests" DROP CONSTRAINT "token_requests_movie_id_fkey";
ALTER TABLE "token_requests" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "token_requests_movie_id_status_idx" RENAME TO "token_requests_project_id_status_idx";
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_movie_id_fkey";
ALTER TABLE "audit_logs" RENAME COLUMN "movie_id" TO "project_id";
ALTER INDEX "audit_logs_movie_id_created_at_idx" RENAME TO "audit_logs_project_id_created_at_idx";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "movie_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigger bodies are text: rewrite those that read the moved columns. Same names, same behaviour.

-- BR-39: nothing of a cancelled project is scheduled or released, whatever code path tries.
CREATE OR REPLACE FUNCTION "enforce_episode_release_project"() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "movie_projects" WHERE "id" = NEW."movie_id" AND "status" = 'CANCELLED') THEN
        RAISE EXCEPTION 'BR-39: episode % belongs to a cancelled project', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BR-13: an episode is given to a Creator of its project.
CREATE OR REPLACE FUNCTION "enforce_episode_assignee_in_project"() RETURNS trigger AS $$
BEGIN
    IF NEW."assigned_creator_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "project_creator_assignments" a
        WHERE a."project_id" = NEW."movie_id" AND a."creator_id" = NEW."assigned_creator_id" AND a."is_active"
    ) THEN
        RAISE EXCEPTION 'BR-13: creator % is not on project %', NEW."assigned_creator_id", NEW."movie_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BR-58: the Submission of a milestone is an episode of the hand-off's project (and season, when set).
CREATE OR REPLACE FUNCTION "enforce_milestone_submission_owner"() RETURNS trigger AS $$
BEGIN
    IF NEW."media_asset_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "media_assets" ma
        JOIN "episodes" e ON e."id" = ma."episode_id"
        JOIN "studio_handoffs" h ON h."id" = NEW."handoff_id"
        WHERE ma."id" = NEW."media_asset_id"
          AND e."movie_id" = h."project_id"
          AND (h."season_id" IS NULL OR e."season_id" = h."season_id")
    ) THEN
        RAISE EXCEPTION 'BR-58: submission % does not belong to the project/season of hand-off %', NEW."media_asset_id", NEW."handoff_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The season of a hand-off belongs to its project.
CREATE OR REPLACE FUNCTION "enforce_handoff_season_movie"() RETURNS trigger AS $$
BEGIN
    IF NEW."season_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "seasons" WHERE "id" = NEW."season_id" AND "movie_id" = NEW."project_id"
    ) THEN
        RAISE EXCEPTION 'BR-59: season % is not a season of project %', NEW."season_id", NEW."project_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
