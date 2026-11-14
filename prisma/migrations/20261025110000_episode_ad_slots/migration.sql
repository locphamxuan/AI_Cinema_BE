-- Mid-roll cues the Admin places by hand on an episode (BR-32): one row per cue, so the row count
-- is how many times ads are inserted. ad_id pins one ad; NULL leaves the cue to the weighted draw.
CREATE TABLE "episode_ad_slots" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL,
    "ad_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_ad_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "episode_ad_slots_position_check" CHECK ("position_seconds" > 0)
);

CREATE UNIQUE INDEX "episode_ad_slots_episode_id_position_seconds_key" ON "episode_ad_slots"("episode_id", "position_seconds");
CREATE INDEX "episode_ad_slots_ad_id_idx" ON "episode_ad_slots"("ad_id");

ALTER TABLE "episode_ad_slots" ADD CONSTRAINT "episode_ad_slots_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_ad_slots" ADD CONSTRAINT "episode_ad_slots_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episode_ad_slots" ADD CONSTRAINT "episode_ad_slots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
