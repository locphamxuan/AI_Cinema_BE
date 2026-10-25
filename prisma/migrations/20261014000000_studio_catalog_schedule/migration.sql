-- Studio catalog, hand-off by season, milestones with Submissions, season/episode release schedule
-- (Mentor review 2026-10-14, BR-58, BR-59, BR-60). The studio portal goes away: the studio has no
-- link any more, the Creator records its milestones and uploads what it delivers (Hướng 2).
-- CHECKs and triggers below are invisible to `prisma migrate diff`; never drop them in a later migration.

-- CreateEnum
CREATE TYPE "StudioMilestoneStatus" AS ENUM ('BRIEF_SENT', 'STUDIO_ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'STUDIO_DECLINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "HandoffMaterialKind" AS ENUM ('BRIEF', 'SCRIPT', 'REFERENCE', 'OTHER');

-- CreateTable
CREATE TABLE "studios" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "contact_name" VARCHAR(255),
    "phone" VARCHAR(30),
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "studios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studios_email_key" ON "studios"("email");

-- AddForeignKey
ALTER TABLE "studios" ADD CONSTRAINT "studios_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every studio typed so far becomes a catalog entry, keyed by e-mail; its latest name and contact win.
INSERT INTO "studios" ("id", "name", "email", "contact_name", "created_by_id", "updated_at")
SELECT gen_random_uuid(), s."name", s."email", s."contact", s."created_by_id", CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (lower(src."email"))
        lower(src."email") AS "email", src."name", src."contact", src."created_by_id"
    FROM (
        SELECT h."studio_email" AS "email", h."studio_name" AS "name", h."studio_contact" AS "contact",
               h."created_by_id", h."created_at" AS "at"
        FROM "studio_handoffs" h
        UNION ALL
        SELECT m."studio_email", m."studio_name", m."studio_contact", m."reviewer_id", m."updated_at"
        FROM "movies" m
        WHERE m."studio_email" IS NOT NULL AND m."studio_name" IS NOT NULL
    ) src
    ORDER BY lower(src."email"), src."at" DESC
) s;

-- Movies: the studio is a catalog entry; the project no longer stores when it was assigned.
ALTER TABLE "movies" ADD COLUMN "studio_id" UUID;
UPDATE "movies" m SET "studio_id" = s."id" FROM "studios" s WHERE s."email" = lower(m."studio_email");

ALTER TABLE "movies" DROP CONSTRAINT "movies_studio_check";
ALTER TABLE "movies" DROP COLUMN "assigned_at",
DROP COLUMN "studio_contact",
DROP COLUMN "studio_email",
DROP COLUMN "studio_name";
-- Same name as before (BR-59): a handed-off project always has its studio.
ALTER TABLE "movies" ADD CONSTRAINT "movies_studio_check" CHECK (
    "status" NOT IN ('IN_PRODUCTION', 'COMPLETED', 'UNDER_REVISION') OR "studio_id" IS NOT NULL
);

CREATE INDEX "movies_studio_id_idx" ON "movies"("studio_id");
ALTER TABLE "movies" ADD CONSTRAINT "movies_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-offs: studio from the catalog, optional season, milestone instead of the portal answer.
ALTER TABLE "studio_handoffs" DROP CONSTRAINT "studio_handoffs_response_complete";
ALTER TABLE "studio_handoffs" ADD COLUMN "milestone_status" "StudioMilestoneStatus" NOT NULL DEFAULT 'BRIEF_SENT',
ADD COLUMN "season_id" UUID,
ADD COLUMN "status_note" TEXT,
ADD COLUMN "studio_id" UUID,
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "studio_handoffs" ALTER COLUMN "updated_at" DROP DEFAULT;

UPDATE "studio_handoffs" h SET "studio_id" = s."id" FROM "studios" s WHERE s."email" = lower(h."studio_email");
-- Only the newest hand-off of a project is current; a studio that declined keeps saying so.
UPDATE "studio_handoffs" h SET "milestone_status" = (CASE
    WHEN h."studio_response" = 'DECLINED' THEN 'STUDIO_DECLINED'
    WHEN EXISTS (
        SELECT 1 FROM "studio_handoffs" newer
        WHERE newer."movie_id" = h."movie_id" AND newer."created_at" > h."created_at"
    ) THEN 'SUPERSEDED'
    WHEN h."studio_response" = 'ACCEPTED' THEN 'STUDIO_ACCEPTED'
    ELSE 'BRIEF_SENT'
END)::"StudioMilestoneStatus";
ALTER TABLE "studio_handoffs" ALTER COLUMN "studio_id" SET NOT NULL;

DROP INDEX "studio_handoffs_portal_token_hash_key";
ALTER TABLE "studio_handoffs" DROP COLUMN "portal_revoked_at",
DROP COLUMN "portal_token_hash",
DROP COLUMN "studio_contact",
DROP COLUMN "studio_email",
DROP COLUMN "studio_name",
DROP COLUMN "studio_response";
DROP TYPE "StudioResponse";

CREATE INDEX "studio_handoffs_studio_id_idx" ON "studio_handoffs"("studio_id");
CREATE INDEX "studio_handoffs_season_id_idx" ON "studio_handoffs"("season_id");
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_decline_reason_check" CHECK (
    "milestone_status" <> 'STUDIO_DECLINED' OR "decline_reason" IS NOT NULL
);

-- Media: every Submission is uploaded by a Creator; portal deliveries are credited to the hand-off's Creator.
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_studio_handoff_id_fkey";
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_one_submitter";
UPDATE "media_assets" ma SET "submitted_by_id" = h."created_by_id"
FROM "studio_handoffs" h
WHERE ma."submitted_by_id" IS NULL AND h."id" = ma."studio_handoff_id";
ALTER TABLE "media_assets" ALTER COLUMN "submitted_by_id" SET NOT NULL;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_studio_handoff_id_fkey" FOREIGN KEY ("studio_handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Episodes: the Reviewer deadline is renamed (episodes_due_date_within_milestone follows the rename and
-- keeps its name), plus the expected release date.
ALTER TABLE "episodes" RENAME COLUMN "milestone_date" TO "delivery_deadline";
ALTER TABLE "episodes" ADD COLUMN "expected_release_date" DATE;
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_release_after_deadline_check" CHECK (
    "expected_release_date" IS NULL OR "delivery_deadline" IS NULL OR "expected_release_date" >= "delivery_deadline"
);

-- Seasons: release window.
ALTER TABLE "seasons" ADD COLUMN "release_end_date" DATE,
ADD COLUMN "release_start_date" DATE;
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_release_window_check" CHECK (
    "release_start_date" IS NULL OR "release_end_date" IS NULL OR "release_start_date" <= "release_end_date"
);

-- CreateTable
CREATE TABLE "studio_handoff_materials" (
    "id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "kind" "HandoffMaterialKind" NOT NULL DEFAULT 'REFERENCE',
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_handoff_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_milestone_events" (
    "id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "from_status" "StudioMilestoneStatus",
    "to_status" "StudioMilestoneStatus" NOT NULL,
    "note" TEXT,
    "media_asset_id" UUID,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_milestone_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "studio_handoff_materials_handoff_id_idx" ON "studio_handoff_materials"("handoff_id");
CREATE INDEX "studio_milestone_events_handoff_id_created_at_idx" ON "studio_milestone_events"("handoff_id", "created_at");

ALTER TABLE "studio_handoff_materials" ADD CONSTRAINT "studio_handoff_materials_handoff_id_fkey" FOREIGN KEY ("handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_handoff_materials" ADD CONSTRAINT "studio_handoff_materials_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "studio_milestone_events" ADD CONSTRAINT "studio_milestone_events_handoff_id_fkey" FOREIGN KEY ("handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_milestone_events" ADD CONSTRAINT "studio_milestone_events_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "studio_milestone_events" ADD CONSTRAINT "studio_milestone_events_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "studio_handoff_materials" ADD CONSTRAINT "studio_handoff_materials_size_check" CHECK (
    "size_bytes" > 0 AND "size_bytes" <= 52428800
);
-- DELIVERED always comes with the Submission; an event always changes the milestone.
ALTER TABLE "studio_milestone_events" ADD CONSTRAINT "studio_milestone_events_delivered_submission_check" CHECK (
    "to_status" <> 'DELIVERED' OR "media_asset_id" IS NOT NULL
);
ALTER TABLE "studio_milestone_events" ADD CONSTRAINT "studio_milestone_events_changed_check" CHECK (
    "from_status" IS NULL OR "from_status" <> "to_status"
);

-- Timeline of the existing hand-offs: when the brief went out, then where the studio stands now.
INSERT INTO "studio_milestone_events" ("id", "handoff_id", "from_status", "to_status", "changed_by_id", "created_at")
SELECT gen_random_uuid(), h."id", NULL, 'BRIEF_SENT', h."created_by_id", h."created_at" FROM "studio_handoffs" h;
INSERT INTO "studio_milestone_events" ("id", "handoff_id", "from_status", "to_status", "note", "changed_by_id", "created_at")
SELECT gen_random_uuid(), h."id", 'BRIEF_SENT', h."milestone_status", h."decline_reason", h."created_by_id",
       COALESCE(h."responded_at", h."created_at")
FROM "studio_handoffs" h
WHERE h."milestone_status" <> 'BRIEF_SENT';

-- BR-60: the expected release date of an episode lies in its season's release window.
CREATE FUNCTION "enforce_episode_release_in_season"() RETURNS trigger AS $$
DECLARE
    s RECORD;
BEGIN
    IF NEW."expected_release_date" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "release_start_date", "release_end_date" INTO s FROM "seasons" WHERE "id" = NEW."season_id";
    IF (s."release_start_date" IS NOT NULL AND NEW."expected_release_date" < s."release_start_date")
       OR (s."release_end_date" IS NOT NULL AND NEW."expected_release_date" > s."release_end_date") THEN
        RAISE EXCEPTION 'BR-60: expected release date of episode % is outside its season window', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_release_in_season"
    BEFORE INSERT OR UPDATE OF "expected_release_date", "season_id" ON "episodes"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_episode_release_in_season"();

-- BR-58: the Submission of a milestone is an episode of the hand-off's movie (and season, when set).
CREATE FUNCTION "enforce_milestone_submission_owner"() RETURNS trigger AS $$
BEGIN
    IF NEW."media_asset_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "media_assets" ma
        JOIN "episodes" e ON e."id" = ma."episode_id"
        JOIN "studio_handoffs" h ON h."id" = NEW."handoff_id"
        WHERE ma."id" = NEW."media_asset_id"
          AND e."movie_id" = h."movie_id"
          AND (h."season_id" IS NULL OR e."season_id" = h."season_id")
    ) THEN
        RAISE EXCEPTION 'BR-58: submission % does not belong to the project/season of hand-off %', NEW."media_asset_id", NEW."handoff_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "studio_milestone_events_submission_owner"
    BEFORE INSERT OR UPDATE OF "media_asset_id" ON "studio_milestone_events"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_milestone_submission_owner"();

-- The season of a hand-off belongs to its movie (Prisma cannot carry the composite key, see schema).
CREATE FUNCTION "enforce_handoff_season_movie"() RETURNS trigger AS $$
BEGIN
    IF NEW."season_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "seasons" WHERE "id" = NEW."season_id" AND "movie_id" = NEW."movie_id"
    ) THEN
        RAISE EXCEPTION 'BR-59: season % is not a season of movie %', NEW."season_id", NEW."movie_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "studio_handoffs_season_movie"
    BEFORE INSERT OR UPDATE OF "season_id", "movie_id" ON "studio_handoffs"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_handoff_season_movie"();

-- The Reviewer keeps the studio catalog. The seed only fills the matrix of a role that has no
-- permission yet, so an existing database gets the key here; a fresh one is left to the seed.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'studio:manage', 'studio', 'Keep the catalog of partner studios: add, edit, deactivate'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'CONTENT_REVIEWER')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'CONTENT_REVIEWER', 'studio:manage'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'CONTENT_REVIEWER')
ON CONFLICT DO NOTHING;
