-- Free episodes of one movie, set by its Reviewer; NULL = the platform's free_starter_episode_count (BR-03).
ALTER TABLE "movies" ADD COLUMN "free_episode_count" INTEGER;
ALTER TABLE "movies" ADD CONSTRAINT "movies_free_episode_count_check" CHECK ("free_episode_count" IS NULL OR "free_episode_count" >= 0);

-- Token a replaced hand-off cost: the studio got the brief and did not decline, so its fee is spent (BR-59).
ALTER TABLE "studio_handoffs" ADD COLUMN "lost_tokens" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_lost_tokens_check" CHECK ("lost_tokens" >= 0 AND "lost_tokens" <= "production_fee_tokens");
