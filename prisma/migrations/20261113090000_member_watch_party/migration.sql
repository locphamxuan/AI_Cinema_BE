-- 2026-11-13: watch rooms and friends are for Members only (Staff, Admin, Studio and the production roles
-- cannot open a room or befriend anyone). New permission granted to MEMBER on databases seeded earlier.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'watch-party:use', 'playback', 'Member xem phim nhóm và kết bạn'
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'MEMBER', 'watch-party:use'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'MEMBER')
ON CONFLICT DO NOTHING;
