-- MF-3 (2026-11-26): an ad has no click-through link and no pick weight any more. The viewer never leaves the
-- episode from an ad, and every cue without a pinned ad takes a uniform random draw among the ACTIVE ads.
ALTER TABLE "ads" DROP COLUMN "click_url";
ALTER TABLE "ads" DROP COLUMN "weight";
