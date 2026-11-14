-- 2026-11-11: the Reviewer stops at the Final Film (BR-14) and the AI label (BR-10);
-- the Admin alone prices episodes and sets the free flags before publishing (BR-29, BR-03/BR-19).
-- Moves the `episode:price` grant from CONTENT_REVIEWER to ADMIN on databases seeded earlier.
DELETE FROM "role_permissions"
WHERE "role" = 'CONTENT_REVIEWER' AND "permission_key" = 'episode:price';

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'episode:price'
WHERE EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'episode:price')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN' AND "permission_key" = 'episode:price'
  );
