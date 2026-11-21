-- Bonus Coins never expire (18/11/2026): the expiry of each batch and the setting that fixed it go away.
-- The hand-written CHECK on platform_settings is re-created for the column that stays.
ALTER TABLE "platform_settings" DROP CONSTRAINT "platform_settings_positive_check";
ALTER TABLE "platform_settings" DROP COLUMN "bonus_coin_expiry_days";
ALTER TABLE "platform_settings"
    ADD CONSTRAINT "platform_settings_positive_check" CHECK ("playback_heartbeat_timeout_seconds" > 0);

-- Batches are now spent oldest first.
DROP INDEX "coin_lots_wallet_id_expires_at_idx";
ALTER TABLE "coin_lots" DROP COLUMN "expires_at";
CREATE INDEX "coin_lots_wallet_id_granted_at_idx" ON "coin_lots"("wallet_id", "granted_at");
