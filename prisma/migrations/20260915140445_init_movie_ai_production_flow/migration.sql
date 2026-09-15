-- CreateEnum
CREATE TYPE "LabelType" AS ENUM ('AI_GENERATED', 'AI_EDITED', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "AiModality" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MULTIMODAL');

-- CreateEnum
CREATE TYPE "ComplianceCheckType" AS ENUM ('AI_LABEL_PRESENCE', 'CONTENT_POLICY', 'COPYRIGHT', 'LEGAL');

-- CreateEnum
CREATE TYPE "ComplianceResult" AS ENUM ('PENDING', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "EpisodeProductionStatus" AS ENUM ('DRAFT', 'PLAN_DRAFT', 'PLAN_SUBMITTED', 'PLAN_CHANGES_REQUESTED', 'PLAN_APPROVED', 'QUOTA_ALLOCATED', 'GENERATING', 'ASSEMBLED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REVIEW_APPROVED', 'COMPLIANCE_PENDING', 'COMPLIANCE_PASSED', 'COMPLIANCE_FAILED', 'PUBLISHING', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EpisodePackageStatus" AS ENUM ('ASSEMBLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('SCRIPT', 'DUB_AUDIO', 'BACKGROUND_AUDIO', 'SUBTITLE', 'POSTER', 'THUMBNAIL', 'VIDEO');

-- CreateEnum
CREATE TYPE "GeneratedAssetStatus" AS ENUM ('GENERATED', 'VALIDATION_FAILED', 'REJECTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "GenerationJobType" AS ENUM ('SCRIPT', 'VOICE', 'BACKGROUND_AUDIO', 'SUBTITLE', 'TRANSLATION', 'POSTER', 'THUMBNAIL', 'VIDEO_ASSEMBLY');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanReviewStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ProductionProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotaAllocationType" AS ENUM ('INITIAL', 'TOP_UP');

-- CreateEnum
CREATE TYPE "QuotaAllocationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RETURNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "ai_content_labels" (
    "id" UUID NOT NULL,
    "episode_package_id" UUID NOT NULL,
    "label_type" "LabelType" NOT NULL,
    "label_text" VARCHAR(500) NOT NULL,
    "display_location" VARCHAR(100),
    "ruleset_version" VARCHAR(50),
    "applied_by_id" UUID,

    CONSTRAINT "ai_content_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "ai_provider_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" VARCHAR(50),
    "modality" "AiModality" NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "actor_type" VARCHAR(50) NOT NULL,
    "actor_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" UUID NOT NULL,
    "episode_package_id" UUID NOT NULL,
    "check_type" "ComplianceCheckType" NOT NULL,
    "result" "ComplianceResult" NOT NULL DEFAULT 'PENDING',
    "ruleset_version" VARCHAR(50),
    "checked_by_id" UUID,
    "checked_by_system" VARCHAR(100),
    "failure_reason" TEXT,
    "checked_at" TIMESTAMPTZ(6),

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "season_id" UUID,
    "episode_number" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "production_status" "EpisodeProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "current_package_id" UUID,
    "production_project_id" UUID NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_packages" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "package_version" INTEGER NOT NULL,
    "assembled_by" UUID,
    "assembly_job_id" UUID,
    "status" "EpisodePackageStatus" NOT NULL DEFAULT 'ASSEMBLED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_package_assets" (
    "episode_package_id" UUID NOT NULL,
    "generated_asset_id" UUID NOT NULL,

    CONSTRAINT "episode_package_assets_pkey" PRIMARY KEY ("episode_package_id","generated_asset_id")
);

-- CreateTable
CREATE TABLE "generated_assets" (
    "id" UUID NOT NULL,
    "generation_job_id" UUID NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "language" VARCHAR(10),
    "content_text" TEXT,
    "storage_key" VARCHAR(500),
    "mime_type" VARCHAR(100),
    "file_size_bytes" BIGINT,
    "checksum_sha256" VARCHAR(64),
    "duration_seconds" INTEGER,
    "resolution" VARCHAR(50),
    "metadata" JSONB,
    "status" "GeneratedAssetStatus" NOT NULL DEFAULT 'GENERATED',
    "is_selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "generated_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "production_plan_id" UUID NOT NULL,
    "ai_model_id" UUID NOT NULL,
    "job_type" "GenerationJobType" NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "parent_job_id" UUID,
    "config_snapshot" JSONB,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'PENDING',
    "external_job_reference" VARCHAR(255),
    "error_message" TEXT,
    "resource_cost" DECIMAL,
    "quota_allocation_id" UUID,
    "queued_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movies" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "synopsis" TEXT,
    "default_language" VARCHAR(10) NOT NULL,
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
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
CREATE TABLE "plan_reviews" (
    "id" UUID NOT NULL,
    "production_plan_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "status" "PlanReviewStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "rejection_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plans" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "previous_plan_id" UUID,
    "script_text" TEXT,
    "scene_breakdown" JSONB,
    "production_approach" TEXT,
    "target_duration_seconds" INTEGER,
    "target_languages" TEXT[],
    "estimated_ai_resource_usage" DECIMAL,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_projects" (
    "id" UUID NOT NULL,
    "movie_id" UUID,
    "season_id" UUID,
    "created_by" UUID NOT NULL,
    "deadline" TIMESTAMPTZ(6) NOT NULL,
    "planned_release_date" TIMESTAMPTZ(6) NOT NULL,
    "total_ai_quota_budget" DECIMAL NOT NULL,
    "remaining_ai_quota_budget" DECIMAL NOT NULL,
    "status" "ProductionProjectStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "production_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "episode_package_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "unpublished_at" TIMESTAMPTZ(6),
    "published_by_id" UUID NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_allocations" (
    "id" UUID NOT NULL,
    "production_plan_id" UUID NOT NULL,
    "production_project_id" UUID NOT NULL,
    "allocation_type" "QuotaAllocationType" NOT NULL,
    "allocated_amount" DECIMAL NOT NULL,
    "remaining_amount" DECIMAL NOT NULL,
    "status" "QuotaAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "episode_package_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "rejection_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_ai_provider_id_name_version_key" ON "ai_models"("ai_provider_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_current_package_id_key" ON "episodes"("current_package_id");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_movie_id_season_id_episode_number_key" ON "episodes"("movie_id", "season_id", "episode_number");

-- CreateIndex
CREATE UNIQUE INDEX "episode_packages_episode_id_package_version_key" ON "episode_packages"("episode_id", "package_version");

-- CreateIndex
CREATE INDEX "generation_jobs_production_plan_id_idx" ON "generation_jobs"("production_plan_id");

-- CreateIndex
CREATE INDEX "generation_jobs_quota_allocation_id_idx" ON "generation_jobs"("quota_allocation_id");

-- CreateIndex
CREATE INDEX "generation_jobs_episode_id_job_type_status_idx" ON "generation_jobs"("episode_id", "job_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_episode_id_plan_version_key" ON "production_plans"("episode_id", "plan_version");

-- CreateIndex
CREATE INDEX "quota_allocations_production_plan_id_status_idx" ON "quota_allocations"("production_plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_movie_id_season_number_key" ON "seasons"("movie_id", "season_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "ai_content_labels" ADD CONSTRAINT "ai_content_labels_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_labels" ADD CONSTRAINT "ai_content_labels_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_ai_provider_id_fkey" FOREIGN KEY ("ai_provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_current_package_id_fkey" FOREIGN KEY ("current_package_id") REFERENCES "episode_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_production_project_id_fkey" FOREIGN KEY ("production_project_id") REFERENCES "production_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_packages" ADD CONSTRAINT "episode_packages_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_packages" ADD CONSTRAINT "episode_packages_assembly_job_id_fkey" FOREIGN KEY ("assembly_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package_assets" ADD CONSTRAINT "episode_package_assets_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package_assets" ADD CONSTRAINT "episode_package_assets_generated_asset_id_fkey" FOREIGN KEY ("generated_asset_id") REFERENCES "generated_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_parent_job_id_fkey" FOREIGN KEY ("parent_job_id") REFERENCES "generation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_quota_allocation_id_fkey" FOREIGN KEY ("quota_allocation_id") REFERENCES "quota_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_previous_plan_id_fkey" FOREIGN KEY ("previous_plan_id") REFERENCES "production_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_production_project_id_fkey" FOREIGN KEY ("production_project_id") REFERENCES "production_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_allocations" ADD CONSTRAINT "quota_allocations_allocated_by_fkey" FOREIGN KEY ("allocated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
