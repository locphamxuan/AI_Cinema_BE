-- Mid-roll ads (BR-32): the Admin places the ad cues of each episode. The seed only fills the matrix of a role
-- that has no permission yet, so an existing database gets the new key here; a fresh one is left to the seed.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'ad.manage', 'advertising', 'Create ads and pause or resume them'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', 'ad.manage'
WHERE EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;
