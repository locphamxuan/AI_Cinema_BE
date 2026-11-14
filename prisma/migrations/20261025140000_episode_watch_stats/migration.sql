-- Daily viewing per episode, rolled up from streaming_sessions before the retention sweep deletes
-- them, so revenue sharing and analytics keep the watch time of purged sessions.
CREATE TABLE "episode_watch_stats" (
    "episode_id" UUID NOT NULL,
    "stat_date" DATE NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "completed_sessions" INTEGER NOT NULL DEFAULT 0,
    "total_watched_seconds" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "episode_watch_stats_pkey" PRIMARY KEY ("episode_id", "stat_date")
);

CREATE INDEX "episode_watch_stats_stat_date_idx" ON "episode_watch_stats"("stat_date");

ALTER TABLE "episode_watch_stats" ADD CONSTRAINT "episode_watch_stats_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
