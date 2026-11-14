-- The rendition ceiling of the plan a session was opened under (features.maxQuality), pinned at
-- creation so the playlist endpoints stop re-reading the subscription on every ABR switch.
-- NULL on rows opened before this column: they keep the default ceiling.
ALTER TABLE "streaming_sessions" ADD COLUMN "max_quality" VARCHAR(10);
