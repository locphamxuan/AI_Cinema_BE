-- BR-56: an episode can be taken down to be fixed (REVISION) or for good (REMOVAL, BR-52).
ALTER TYPE "MovieStatus" ADD VALUE 'UNDER_REVISION' BEFORE 'CANCELLED';

CREATE TYPE "UnpublishMode" AS ENUM ('REVISION', 'REMOVAL');

ALTER TABLE "episodes" ADD COLUMN "revision_started_at" TIMESTAMPTZ(6);

ALTER TABLE "publications" ADD COLUMN "unpublish_mode" "UnpublishMode";

-- Releases taken down before the two modes existed were taken down for good.
UPDATE "publications" SET "unpublish_mode" = 'REMOVAL'
WHERE "published_at" IS NOT NULL AND "unpublished_at" IS NOT NULL;

ALTER TABLE "publications" ADD CONSTRAINT "publications_unpublish_mode_check"
    CHECK ("published_at" IS NULL OR "unpublished_at" IS NULL OR "unpublish_mode" IS NOT NULL);
