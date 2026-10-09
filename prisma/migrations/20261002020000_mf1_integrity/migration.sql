-- Integrity fixes from the MF-1 audit (2026-10-02). Triggers and CHECKs only: `prisma migrate diff`
-- does not see them, so prisma/schema stays unchanged.

-- BR-14: the approved version of an episode must be one of its own deliveries.
CREATE FUNCTION "enforce_episode_approved_media_owner"() RETURNS trigger AS $$
BEGIN
    IF NEW."approved_media_asset_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "media_assets"
        WHERE "id" = NEW."approved_media_asset_id" AND "episode_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'BR-14: media % is not a delivery of episode %', NEW."approved_media_asset_id", NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_approved_media_owner"
    BEFORE INSERT OR UPDATE OF "approved_media_asset_id" ON "episodes"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_episode_approved_media_owner"();

-- BR-39: nothing of a cancelled project is scheduled or released, whatever code path tries.
CREATE FUNCTION "enforce_episode_release_project"() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "movies" WHERE "id" = NEW."movie_id" AND "status" = 'CANCELLED') THEN
        RAISE EXCEPTION 'BR-39: episode % belongs to a cancelled project', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_release_project"
    BEFORE INSERT OR UPDATE OF "status" ON "episodes"
    FOR EACH ROW
    WHEN (NEW."status" IN ('SCHEDULED', 'PUBLISHED'))
    EXECUTE FUNCTION "enforce_episode_release_project"();

-- UNDER_REVISION (BR-56) came after this CHECK: a movie being fixed still has its studio.
ALTER TABLE "movies" DROP CONSTRAINT "movies_studio_check";
ALTER TABLE "movies" ADD CONSTRAINT "movies_studio_check" CHECK (
    "status" NOT IN ('IN_PRODUCTION', 'COMPLETED', 'UNDER_REVISION')
    OR ("studio_name" IS NOT NULL AND "studio_email" IS NOT NULL)
);
