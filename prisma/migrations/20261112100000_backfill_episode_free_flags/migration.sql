-- BR-03 (2026-11-11): free episodes are now the Admin's per-episode flags, read by the catalog, the access
-- decision, the purchase and the playback check alike. Episodes that existed before the flags were free by
-- position (the movie's free_episode_count, else the platform's free_starter_episode_count); keep them free
-- so nothing a viewer could watch yesterday gets a price today. Rows already flagged are left as they are.
UPDATE "episodes" AS e
SET "is_free_for_guest" = true,
    "is_free_for_member" = true
FROM "movies" AS m
WHERE e."movie_id" = m."id"
  AND e."is_free_for_guest" = false
  AND e."is_free_for_member" = false
  AND e."episode_number" <= COALESCE(
        m."free_episode_count",
        (SELECT "free_starter_episode_count" FROM "platform_settings" LIMIT 1),
        2
      );
