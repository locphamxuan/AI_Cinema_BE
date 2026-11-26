-- MF-1 (2026-11-24): rounds signed before signature images (2026-11-22) hold no image of the side that signed, so
-- the other side could never complete them ("The other side has not signed this round yet"). Each such round that
-- is still open and still answerable is closed (SUPERSEDED) and a fresh unsigned round (SENT, no cost) opens for
-- the same studio and hand-off, chained to it, exactly as a resend would: the studio signs again with an image.
-- The studio accounts and the Admins are told in the app. One statement, so it can be re-run as a no-op.
WITH legacy AS (
    SELECT c."id", c."project_id", c."studio_id", c."handoff_id", c."round", c."terms", c."created_by_id"
    FROM "contracts" c
    JOIN "movie_projects" p ON p."id" = c."project_id"
    LEFT JOIN "studio_handoffs" h ON h."id" = c."handoff_id"
    WHERE ((c."status" = 'STUDIO_SIGNED' AND NOT EXISTS (
                SELECT 1 FROM "contract_signatures" s WHERE s."contract_id" = c."id" AND s."side" = 'STUDIO'))
        OR (c."status" = 'ADMIN_COUNTERED' AND NOT EXISTS (
                SELECT 1 FROM "contract_signatures" s WHERE s."contract_id" = c."id" AND s."side" = 'ADMIN')))
      AND ((c."handoff_id" IS NULL AND p."status" = 'ASSIGNED')
        OR (h."milestone_status" = 'BRIEF_SENT' AND p."status" IN ('IN_PRODUCTION', 'UNDER_REVISION')))
),
closed AS (
    UPDATE "contracts" c SET "status" = 'SUPERSEDED', "updated_at" = now()
    FROM legacy l WHERE c."id" = l."id"
    RETURNING c."id"
),
reopened AS (
    INSERT INTO "contracts" ("id", "project_id", "studio_id", "handoff_id", "round", "previous_id", "status", "terms",
                             "created_by_id", "created_at", "updated_at")
    SELECT gen_random_uuid(), l."project_id", l."studio_id", l."handoff_id", l."round" + 1, l."id", 'SENT', l."terms",
           l."created_by_id", now(), now()
    FROM legacy l JOIN closed ON closed."id" = l."id"
    RETURNING "id", "project_id", "studio_id"
)
INSERT INTO "notifications" ("id", "user_id", "type", "title", "body", "link", "payload")
SELECT gen_random_uuid(), u."id", 'CONTRACT_UPDATED', 'Hợp đồng phim "' || m."title" || '" có cập nhật',
       'Hệ thống đã chuyển sang ký hợp đồng bằng ảnh chữ ký nên đã mở lại hợp đồng ở vòng mới. Vui lòng ký lại bằng ảnh chữ ký.',
       CASE WHEN u."role" = 'STUDIO' THEN '/contracts' ELSE '/projects/' || r."project_id" || '/contract' END,
       jsonb_build_object('projectId', r."project_id", 'contractId', r."id")
FROM reopened r
JOIN "movies" m ON m."id" = r."project_id"
JOIN "users" u ON u."is_active"
    AND ((u."role" = 'STUDIO' AND u."studio_id" = r."studio_id") OR u."role" = 'ADMIN');
