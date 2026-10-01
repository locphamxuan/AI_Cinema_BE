-- BR-19 / SF-G: Database-Enforced Compliance Gate.
-- An episode can only become SCHEDULED or PUBLISHED with a reviewed version that carries an
-- AI label (BR-40), passed all four compliance items (BR-42) and has a Coin price (BR-29),
-- whatever code path writes it. A publication must point at that reviewed version (BR-14).

CREATE FUNCTION "enforce_episode_publish_gate"() RETURNS trigger AS $$
BEGIN
    IF NEW."approved_media_asset_id" IS NULL THEN
        RAISE EXCEPTION 'BR-19: episode % has no approved media version', NEW."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."coin_price" IS NULL THEN
        RAISE EXCEPTION 'BR-19: episode % has no Coin price', NEW."id" USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "ai_content_labels" WHERE "media_asset_id" = NEW."approved_media_asset_id"
    ) THEN
        RAISE EXCEPTION 'BR-40: the approved version of episode % has no AI label', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    IF (
        SELECT COUNT(DISTINCT "check_type") FROM "compliance_checks"
        WHERE "media_asset_id" = NEW."approved_media_asset_id" AND "result" = 'PASS'
    ) < 4 THEN
        RAISE EXCEPTION 'BR-42: the approved version of episode % did not pass all compliance checks', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "episodes_publish_gate"
    BEFORE INSERT OR UPDATE OF "status", "approved_media_asset_id", "coin_price" ON "episodes"
    FOR EACH ROW
    WHEN (NEW."status" IN ('SCHEDULED', 'PUBLISHED'))
    EXECUTE FUNCTION "enforce_episode_publish_gate"();

CREATE FUNCTION "enforce_publication_media"() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "episodes"
        WHERE "id" = NEW."episode_id" AND "approved_media_asset_id" = NEW."media_asset_id"
    ) THEN
        RAISE EXCEPTION 'BR-14: publication % must use the approved version of its episode', NEW."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "publications_approved_media"
    BEFORE INSERT ON "publications"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_publication_media"();
