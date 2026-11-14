-- Ads no longer run in a date window: an ACTIVE ad is in the draw until the Admin pauses it.
ALTER TABLE "ads" DROP COLUMN "valid_from",
DROP COLUMN "valid_to";
