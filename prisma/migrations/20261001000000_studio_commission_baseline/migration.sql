-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MediaSourceMethod" AS ENUM ('UPLOAD', 'HLS_URL', 'REMOTE_FILE');

-- CreateEnum
CREATE TYPE "MediaIngestStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'TRANSCODING', 'VALIDATING', 'READY', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "IngestJobType" AS ENUM ('DOWNLOAD', 'TRANSCODE', 'VALIDATE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MovieStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'AWAITING_MEDIA', 'PROCESSING', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'LABELED', 'COMPLIANCE_PASSED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('AI_LABELING', 'CONTENT_POLICY', 'COPYRIGHT', 'LEGAL', 'PUBLISHING');

-- CreateEnum
CREATE TYPE "UnpublishReason" AS ENUM ('MANUAL', 'COMPLIANCE_ISSUE', 'BROKEN_SOURCE');

-- CreateEnum
CREATE TYPE "PriceAlertStatus" AS ENUM ('OPEN', 'CHANGE_REQUESTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ContentReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "LabelType" AS ENUM ('AI_GENERATED', 'AI_EDITED', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "ComplianceCheckType" AS ENUM ('AI_LABEL_PRESENCE', 'DECREE_142_NOTICE', 'CONTENT_SAFETY', 'REAL_PERSON_LIKENESS');

-- CreateEnum
CREATE TYPE "ComplianceResult" AS ENUM ('PENDING', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "TokenEntryType" AS ENUM ('INITIAL', 'TOP_UP', 'CORRECTION');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "actor_type" VARCHAR(50) NOT NULL,
    "actor_id" UUID,
    "movie_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source_method" "MediaSourceMethod" NOT NULL,
    "source_url" VARCHAR(1000),
    "storage_key" VARCHAR(500),
    "stream_url" VARCHAR(1000),
    "is_self_hosted" BOOLEAN NOT NULL DEFAULT true,
    "qualities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_seconds" INTEGER,
    "file_size_bytes" BIGINT,
    "ingest_status" "MediaIngestStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "ai_disclosure" JSONB NOT NULL,
    "proposed_label_type" "LabelType" NOT NULL,
    "submission_note" TEXT,
    "submitted_by_id" UUID NOT NULL,
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_ingest_jobs" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "job_type" "IngestJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress_percent" SMALLINT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_ingest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_subtitles" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "media_subtitles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "to_email" VARCHAR(255) NOT NULL,
    "template" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "attachment_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "link" VARCHAR(500),
    "payload" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movies" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "idea_description" TEXT NOT NULL,
    "synopsis" TEXT,
    "default_language" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "age_rating" VARCHAR(10),
    "release_year" INTEGER,
    "status" "MovieStatus" NOT NULL DEFAULT 'DRAFT',
    "ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "poster_url" VARCHAR(500),
    "banner_url" VARCHAR(500),
    "trailer_url" VARCHAR(500),
    "reviewer_id" UUID NOT NULL,
    "creator_id" UUID,
    "studio_name" VARCHAR(255),
    "studio_email" VARCHAR(255),
    "studio_contact" VARCHAR(255),
    "cancel_reason" TEXT,
    "assigned_at" TIMESTAMPTZ(6),
    "handed_off_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_genres" (
    "movie_id" UUID NOT NULL,
    "genre_id" UUID NOT NULL,

    CONSTRAINT "movie_genres_pkey" PRIMARY KEY ("movie_id","genre_id")
);

-- CreateTable
CREATE TABLE "movie_idea_files" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movie_idea_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_handoffs" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "studio_name" VARCHAR(255) NOT NULL,
    "studio_email" VARCHAR(255) NOT NULL,
    "studio_contact" VARCHAR(255),
    "production_fee_tokens" BIGINT NOT NULL,
    "change_reason" TEXT,
    "brief_file_key" VARCHAR(500),
    "email_message_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "season_number" INTEGER NOT NULL,
    "title" VARCHAR(255),

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "synopsis" TEXT,
    "thumbnail_url" VARCHAR(500),
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "target_duration_seconds" INTEGER NOT NULL,
    "due_date" DATE,
    "approved_media_asset_id" UUID,
    "coin_price" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_change_requests" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "episode_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "reviewer_response" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" VARCHAR(64) NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "UserRole" NOT NULL,
    "permission_key" VARCHAR(64) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_key")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "free_starter_episode_count" INTEGER NOT NULL DEFAULT 2,
    "token_rate_vnd" INTEGER NOT NULL DEFAULT 1000,
    "coin_rate_vnd" INTEGER NOT NULL DEFAULT 1000,
    "episode_coin_price_min" INTEGER NOT NULL DEFAULT 1,
    "episode_coin_price_max" INTEGER NOT NULL DEFAULT 50,
    "bonus_coin_expiry_days" INTEGER NOT NULL DEFAULT 30,
    "playback_heartbeat_timeout_seconds" INTEGER NOT NULL DEFAULT 90,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "PolicyType" NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "document_reference" TEXT,
    "content" JSONB,
    "effective_from" TIMESTAMPTZ(6),
    "effective_to" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "unpublished_at" TIMESTAMPTZ(6),
    "unpublish_reason" "UnpublishReason",
    "unpublish_note" TEXT,
    "published_by_id" UUID NOT NULL,
    "unpublished_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "coin_price" INTEGER NOT NULL,
    "range_min" INTEGER NOT NULL,
    "range_max" INTEGER NOT NULL,
    "set_by_id" UUID NOT NULL,
    "status" "PriceAlertStatus" NOT NULL DEFAULT 'OPEN',
    "admin_note" TEXT,
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reviews" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ContentReviewDecision" NOT NULL,
    "comments" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_content_labels" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "label_type" "LabelType" NOT NULL,
    "label_text" VARCHAR(500) NOT NULL,
    "display_location" VARCHAR(100),
    "applied_by_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_content_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "check_type" "ComplianceCheckType" NOT NULL,
    "result" "ComplianceResult" NOT NULL DEFAULT 'PENDING',
    "checked_by_id" UUID,
    "failure_reason" TEXT,
    "checked_at" TIMESTAMPTZ(6),
    "policy_id" UUID NOT NULL,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_ledger" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "entry_type" "TokenEntryType" NOT NULL,
    "amount_tokens" BIGINT NOT NULL,
    "rate_vnd" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "date_of_birth" DATE,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "email_verified_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_movie_id_created_at_idx" ON "audit_logs"("movie_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE INDEX "media_assets_ingest_status_idx" ON "media_assets"("ingest_status");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_episode_id_version_key" ON "media_assets"("episode_id", "version");

-- CreateIndex
CREATE INDEX "media_ingest_jobs_media_asset_id_idx" ON "media_ingest_jobs"("media_asset_id");

-- CreateIndex
CREATE INDEX "media_ingest_jobs_status_idx" ON "media_ingest_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "media_subtitles_media_asset_id_language_key" ON "media_subtitles"("media_asset_id", "language");

-- CreateIndex
CREATE INDEX "email_messages_status_idx" ON "email_messages"("status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "movies_status_idx" ON "movies"("status");

-- CreateIndex
CREATE INDEX "movies_reviewer_id_idx" ON "movies"("reviewer_id");

-- CreateIndex
CREATE INDEX "movies_creator_id_idx" ON "movies"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "movie_idea_files_movie_id_file_name_version_key" ON "movie_idea_files"("movie_id", "file_name", "version");

-- CreateIndex
CREATE INDEX "studio_handoffs_movie_id_created_at_idx" ON "studio_handoffs"("movie_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_movie_id_season_number_key" ON "seasons"("movie_id", "season_number");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_id_movie_id_key" ON "seasons"("id", "movie_id");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_approved_media_asset_id_key" ON "episodes"("approved_media_asset_id");

-- CreateIndex
CREATE INDEX "episodes_movie_id_status_idx" ON "episodes"("movie_id", "status");

-- CreateIndex
CREATE INDEX "episodes_due_date_idx" ON "episodes"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_movie_id_episode_number_key" ON "episodes"("movie_id", "episode_number");

-- CreateIndex
CREATE INDEX "project_change_requests_movie_id_status_idx" ON "project_change_requests"("movie_id", "status");

-- CreateIndex
CREATE INDEX "project_change_requests_status_created_at_idx" ON "project_change_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "publications_episode_id_idx" ON "publications"("episode_id");

-- CreateIndex
CREATE INDEX "publications_scheduled_at_idx" ON "publications"("scheduled_at");

-- CreateIndex
CREATE INDEX "price_alerts_status_created_at_idx" ON "price_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "price_alerts_episode_id_idx" ON "price_alerts"("episode_id");

-- CreateIndex
CREATE INDEX "content_reviews_media_asset_id_idx" ON "content_reviews"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_content_labels_media_asset_id_key" ON "ai_content_labels"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_checks_media_asset_id_check_type_key" ON "compliance_checks"("media_asset_id", "check_type");

-- CreateIndex
CREATE INDEX "token_ledger_movie_id_created_at_idx" ON "token_ledger"("movie_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_ingest_jobs" ADD CONSTRAINT "media_ingest_jobs_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_subtitles" ADD CONSTRAINT "media_subtitles_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_idea_files" ADD CONSTRAINT "movie_idea_files_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_idea_files" ADD CONSTRAINT "movie_idea_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_movie_id_fkey" FOREIGN KEY ("season_id", "movie_id") REFERENCES "seasons"("id", "movie_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_approved_media_asset_id_fkey" FOREIGN KEY ("approved_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_unpublished_by_id_fkey" FOREIGN KEY ("unpublished_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_labels" ADD CONSTRAINT "ai_content_labels_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_labels" ADD CONSTRAINT "ai_content_labels_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_labels" ADD CONSTRAINT "ai_content_labels_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Business rules Prisma cannot express (docs/database_schema.sql). Keep them
-- when a later migration is generated: `prisma migrate diff` does not see CHECKs.
-- ---------------------------------------------------------------------
ALTER TABLE "platform_settings"
    ADD CONSTRAINT "platform_settings_free_starter_check" CHECK ("free_starter_episode_count" >= 0),
    ADD CONSTRAINT "platform_settings_rate_check" CHECK ("token_rate_vnd" > 0 AND "coin_rate_vnd" > 0),
    ADD CONSTRAINT "platform_settings_price_range_check" CHECK ("episode_coin_price_min" >= 0 AND "episode_coin_price_max" >= "episode_coin_price_min"),
    ADD CONSTRAINT "platform_settings_positive_check" CHECK ("bonus_coin_expiry_days" > 0 AND "playback_heartbeat_timeout_seconds" > 0);

ALTER TABLE "movies"
    ADD CONSTRAINT "movies_ai_generated_check" CHECK ("ai_generated" = true),
    ADD CONSTRAINT "movies_age_rating_check" CHECK ("age_rating" IS NULL OR "age_rating" IN ('T16', 'T18')),
    ADD CONSTRAINT "movies_assigned_creator_check" CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "creator_id" IS NOT NULL),
    ADD CONSTRAINT "movies_studio_check" CHECK ("status" NOT IN ('IN_PRODUCTION', 'COMPLETED') OR ("studio_name" IS NOT NULL AND "studio_email" IS NOT NULL)),
    ADD CONSTRAINT "movies_cancel_check" CHECK ("status" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL);

ALTER TABLE "movie_idea_files"
    ADD CONSTRAINT "movie_idea_files_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520);

ALTER TABLE "studio_handoffs"
    ADD CONSTRAINT "studio_handoffs_fee_check" CHECK ("production_fee_tokens" > 0);

ALTER TABLE "episodes"
    ADD CONSTRAINT "episodes_number_check" CHECK ("episode_number" >= 1),
    ADD CONSTRAINT "episodes_target_duration_check" CHECK ("target_duration_seconds" > 0),
    ADD CONSTRAINT "episodes_coin_price_check" CHECK ("coin_price" IS NULL OR "coin_price" >= 0),
    ADD CONSTRAINT "episodes_publish_price_check" CHECK ("status" NOT IN ('SCHEDULED', 'PUBLISHED') OR "coin_price" IS NOT NULL);

ALTER TABLE "project_change_requests"
    ADD CONSTRAINT "project_change_requests_reject_check" CHECK ("status" <> 'REJECTED' OR "reviewer_response" IS NOT NULL),
    ADD CONSTRAINT "project_change_requests_resolved_check" CHECK (("status" = 'OPEN') = ("resolved_at" IS NULL));

ALTER TABLE "token_ledger"
    ADD CONSTRAINT "token_ledger_amount_check" CHECK (
        ("entry_type" IN ('INITIAL', 'TOP_UP') AND "amount_tokens" > 0)
        OR ("entry_type" = 'CORRECTION' AND "amount_tokens" <> 0)),
    ADD CONSTRAINT "token_ledger_rate_check" CHECK ("rate_vnd" > 0),
    ADD CONSTRAINT "token_ledger_reason_check" CHECK ("entry_type" = 'INITIAL' OR "reason" IS NOT NULL);

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_source_check" CHECK (
        ("source_method" = 'UPLOAD' AND "storage_key" IS NOT NULL)
        OR ("source_method" IN ('HLS_URL', 'REMOTE_FILE') AND "source_url" IS NOT NULL)),
    ADD CONSTRAINT "media_assets_ready_check" CHECK (
        "ingest_status" NOT IN ('READY', 'SUPERSEDED') OR ("stream_url" IS NOT NULL AND "duration_seconds" IS NOT NULL)),
    ADD CONSTRAINT "media_assets_failed_check" CHECK ("ingest_status" <> 'FAILED' OR "failure_reason" IS NOT NULL);

ALTER TABLE "content_reviews"
    ADD CONSTRAINT "content_reviews_changes_comment_check" CHECK ("decision" = 'APPROVED' OR "comments" IS NOT NULL);

ALTER TABLE "compliance_checks"
    ADD CONSTRAINT "compliance_checks_fail_reason_check" CHECK ("result" <> 'FAIL' OR "failure_reason" IS NOT NULL);

ALTER TABLE "publications"
    ADD CONSTRAINT "publications_unpublish_check" CHECK ("unpublished_at" IS NULL OR "unpublish_reason" IS NOT NULL);

ALTER TABLE "price_alerts"
    ADD CONSTRAINT "price_alerts_out_of_range_check" CHECK ("coin_price" < "range_min" OR "coin_price" > "range_max");
