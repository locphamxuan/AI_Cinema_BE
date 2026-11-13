-- 2026-11-12: the Admin alone works with studios (MF-1): choosing or changing the studio of a project,
-- the studio catalog and cancelling a project. The Reviewer keeps reading studios through project:manage.
DELETE FROM "role_permissions"
WHERE "role" = 'CONTENT_REVIEWER' AND "permission_key" = 'studio:manage';

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'studio:manage'
WHERE EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'studio:manage')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN' AND "permission_key" = 'studio:manage'
  );
