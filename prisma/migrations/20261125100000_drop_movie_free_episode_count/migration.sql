-- The per-movie free episode count was replaced by the per-episode flags is_free_for_guest /
-- is_free_for_member (BR-03, backfilled by 20261112100000). Nothing reads the column any more.
ALTER TABLE "movies" DROP CONSTRAINT IF EXISTS "movies_free_episode_count_check";
ALTER TABLE "movies" DROP COLUMN IF EXISTS "free_episode_count";
