-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "AdBreakStatus" AS ENUM ('SCHEDULED', 'PLAYED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PlaybackAccessType" AS ENUM ('FREE_STARTER', 'PLAN', 'EPISODE_PURCHASE', 'SERIES_PURCHASE', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "StreamingSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED', 'KICKED');

-- CreateEnum
CREATE TYPE "StreamingEndReason" AS ENUM ('COMPLETED', 'STOPPED', 'EXPIRED', 'KICKED', 'ERROR');

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "ad_max_breaks_per_episode" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "episode_completion_percent" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "media_url" VARCHAR(1000) NOT NULL,
    "click_url" VARCHAR(1000),
    "duration_seconds" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "status" "AdStatus" NOT NULL DEFAULT 'ACTIVE',
    "valid_from" TIMESTAMPTZ(6),
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_ad_breaks" (
    "id" UUID NOT NULL,
    "streaming_session_id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL,
    "status" "AdBreakStatus" NOT NULL DEFAULT 'SCHEDULED',
    "played_at" TIMESTAMPTZ(6),
    "completed_view" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_ad_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streaming_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guest_key" VARCHAR(255),
    "episode_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "access_type" "PlaybackAccessType" NOT NULL,
    "status" "StreamingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "total_watched_seconds" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" "StreamingEndReason",
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),

    CONSTRAINT "streaming_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "last_watched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ads_status_idx" ON "ads"("status");

-- CreateIndex
CREATE INDEX "session_ad_breaks_streaming_session_id_idx" ON "session_ad_breaks"("streaming_session_id");

-- CreateIndex
CREATE INDEX "session_ad_breaks_ad_id_idx" ON "session_ad_breaks"("ad_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_ad_breaks_streaming_session_id_position_seconds_key" ON "session_ad_breaks"("streaming_session_id", "position_seconds");

-- CreateIndex
CREATE INDEX "streaming_sessions_user_id_status_idx" ON "streaming_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "streaming_sessions_guest_key_idx" ON "streaming_sessions"("guest_key");

-- CreateIndex
CREATE INDEX "streaming_sessions_episode_id_idx" ON "streaming_sessions"("episode_id");

-- CreateIndex
CREATE INDEX "streaming_sessions_status_last_heartbeat_at_idx" ON "streaming_sessions"("status", "last_heartbeat_at");

-- CreateIndex
CREATE INDEX "watch_progress_user_id_last_watched_at_idx" ON "watch_progress"("user_id", "last_watched_at");

-- CreateIndex
CREATE UNIQUE INDEX "watch_progress_user_id_episode_id_key" ON "watch_progress"("user_id", "episode_id");

-- AddForeignKey
ALTER TABLE "session_ad_breaks" ADD CONSTRAINT "session_ad_breaks_streaming_session_id_fkey" FOREIGN KEY ("streaming_session_id") REFERENCES "streaming_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ad_breaks" ADD CONSTRAINT "session_ad_breaks_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaming_sessions" ADD CONSTRAINT "streaming_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaming_sessions" ADD CONSTRAINT "streaming_sessions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaming_sessions" ADD CONSTRAINT "streaming_sessions_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
