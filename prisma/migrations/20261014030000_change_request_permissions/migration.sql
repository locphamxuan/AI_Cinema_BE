-- Change requests flow Reviewer / Creator → Admin (BR-55). The seed only fills the matrix of a role that has
-- no permission yet, so an existing database gets the new keys here; a fresh one is left to the seed.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'project:change.review', 'movie-project', 'Approve or reject the change requests of Reviewers and Creators (BR-55)'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT ("key") DO NOTHING;

UPDATE "permissions" SET "description" = 'Send the Admin a change request for a project, with the reason and proof (BR-55)'
WHERE "key" = 'project:suggest';

DELETE FROM "role_permissions" WHERE "role" = 'ADMIN' AND "permission_key" = 'project:suggest';

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'project:change.review'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT r."role", 'project:suggest'
FROM (VALUES ('CONTENT_REVIEWER'::"UserRole"), ('CONTENT_CREATOR'::"UserRole")) AS r("role")
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = r."role")
ON CONFLICT DO NOTHING;
