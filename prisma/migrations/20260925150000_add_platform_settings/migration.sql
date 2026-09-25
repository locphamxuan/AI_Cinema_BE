-- Platform-wide limits the Admin configures (a single "default" row).
-- The episode duration cap replaces the fixed 30 minutes of BR-31; ads are configured per membership plan in MF-3.

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "max_episode_duration_seconds" INTEGER,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id", "max_episode_duration_seconds", "updated_at") VALUES ('default', 3600, CURRENT_TIMESTAMP);
