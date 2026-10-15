-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'IN_PRODUCTION', 'COMPLETED', 'UNDER_REVISION');

-- Seasons: status (rolled up from the episodes below), price of one episode, timestamps.
ALTER TABLE "seasons" ADD COLUMN "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "episode_production_cost" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "seasons" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_episode_cost_check" CHECK ("episode_production_cost" >= 0);

-- A project funded before seasons were priced: its fee spread over its episodes gives the price.
UPDATE "seasons" s SET "episode_production_cost" = COALESCE((
    SELECT ROUND(SUM(l."amount_tokens")::numeric / NULLIF((SELECT COUNT(*) FROM "episodes" e WHERE e."movie_id" = s."movie_id"), 0))
    FROM "token_ledger" l WHERE l."movie_id" = s."movie_id"
), 0);

-- Token ledger: the season an entry is priced for.
ALTER TABLE "token_ledger" ADD COLUMN "season_id" UUID;
CREATE INDEX "token_ledger_season_id_idx" ON "token_ledger"("season_id");
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Several Creators per project, with delegation (BR-13).
CREATE TABLE "project_creator_assignments" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "delegated_from_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_creator_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_creator_assignments_movie_id_is_active_idx" ON "project_creator_assignments"("movie_id", "is_active");
CREATE INDEX "project_creator_assignments_creator_id_idx" ON "project_creator_assignments"("creator_id");
-- A Creator holds one active seat per project.
CREATE UNIQUE INDEX "project_creator_assignments_active_key" ON "project_creator_assignments"("movie_id", "creator_id") WHERE "is_active";
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_delegated_from_id_fkey" FOREIGN KEY ("delegated_from_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_creator_assignments" ADD CONSTRAINT "project_creator_assignments_unassigned_check" CHECK (("is_active" = true) = ("unassigned_at" IS NULL));

-- The lead Creator of every assigned project holds an assignment.
INSERT INTO "project_creator_assignments" ("id", "movie_id", "creator_id", "assigned_by_id")
SELECT gen_random_uuid(), m."id", m."creator_id", m."reviewer_id" FROM "movies" m WHERE m."creator_id" IS NOT NULL;

-- Episodes: the Creator in charge of one episode.
ALTER TABLE "episodes" ADD COLUMN "assigned_creator_id" UUID;
CREATE INDEX "episodes_assigned_creator_id_idx" ON "episodes"("assigned_creator_id");
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_assigned_creator_id_fkey" FOREIGN KEY ("assigned_creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BR-13: an episode is given to a Creator of its project.
CREATE FUNCTION "enforce_episode_assignee_in_project"() RETURNS trigger AS $$
BEGIN
    IF NEW."assigned_creator_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "project_creator_assignments" a
        WHERE a."movie_id" = NEW."movie_id" AND a."creator_id" = NEW."assigned_creator_id" AND a."is_active"
    ) THEN
        RAISE EXCEPTION 'BR-13: creator % is not on project %', NEW."assigned_creator_id", NEW."movie_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_assignee_in_project"
    BEFORE INSERT OR UPDATE OF "assigned_creator_id" ON "episodes"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_episode_assignee_in_project"();

-- Episode → Season roll-up (BR-37): UNDER_REVISION while an episode is taken down to be fixed (BR-56),
-- COMPLETED once every episode is out, DRAFT while none was handed off, IN_PRODUCTION in between.
CREATE FUNCTION "refresh_season_status"(p_season UUID) RETURNS void AS $$
DECLARE
    total INT;
    drafts INT;
    released INT;
    revising INT;
    rolled "SeasonStatus";
BEGIN
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE "status" = 'DRAFT'),
           COUNT(*) FILTER (WHERE "status" IN ('PUBLISHED', 'UNPUBLISHED')),
           COUNT(*) FILTER (WHERE "revision_started_at" IS NOT NULL)
    INTO total, drafts, released, revising
    FROM "episodes" WHERE "season_id" = p_season;

    rolled := CASE
        WHEN revising > 0 THEN 'UNDER_REVISION'
        WHEN total > 0 AND released = total THEN 'COMPLETED'
        WHEN drafts = total THEN 'DRAFT'
        ELSE 'IN_PRODUCTION'
    END;
    UPDATE "seasons" SET "status" = rolled, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = p_season AND "status" IS DISTINCT FROM rolled;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "episodes_roll_up_season_status"() RETURNS trigger AS $$
BEGIN
    IF TG_OP <> 'DELETE' THEN
        PERFORM "refresh_season_status"(NEW."season_id");
    END IF;
    IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD."season_id" IS DISTINCT FROM NEW."season_id") THEN
        PERFORM "refresh_season_status"(OLD."season_id");
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_season_status"
    AFTER INSERT OR DELETE OR UPDATE OF "status", "revision_started_at", "season_id" ON "episodes"
    FOR EACH ROW
    EXECUTE FUNCTION "episodes_roll_up_season_status"();

SELECT "refresh_season_status"("id") FROM "seasons";
