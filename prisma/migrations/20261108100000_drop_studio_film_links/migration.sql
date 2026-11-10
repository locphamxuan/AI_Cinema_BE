-- MF-1 (08/11/2026): the studio delivers its films on the Studio Web with its own login, so the Studio Web no longer
-- reports films it mailed to the Creator. The `film-sent` webhook, its links and the Creator's milestone rights go.
-- Hand-written: the permission clean-up below is invisible to `prisma migrate diff`.

DROP TABLE "studio_film_links";

ALTER TABLE "studio_handoffs" DROP COLUMN "film_sent_at", DROP COLUMN "film_sent_note";

-- Milestones move by themselves now (contract signed, film delivered, changes requested): nobody holds studio:handoff.
DELETE FROM "role_permissions" WHERE "permission_key" = 'studio:handoff';
DELETE FROM "permissions" WHERE "key" = 'studio:handoff';

UPDATE "permissions"
SET "description" = 'Work on the episodes of an assigned project: team, delegations, episode notes (films come from the studio)'
WHERE "key" = 'media:ingest';
