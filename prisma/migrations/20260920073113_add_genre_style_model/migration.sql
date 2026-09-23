-- CreateEnum
CREATE TYPE "GenreStyleModelStatus" AS ENUM ('DRAFT', 'DATASET_READY', 'TRAINING', 'READY', 'FAILED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "genre_style_model_id" UUID;

-- AlterTable
ALTER TABLE "production_projects" ADD COLUMN     "primary_genre_id" UUID;

-- CreateTable
CREATE TABLE "genre_style_models" (
    "id" UUID NOT NULL,
    "genre_id" UUID NOT NULL,
    "base_ai_model_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "trigger_keyword" VARCHAR(100) NOT NULL,
    "status" "GenreStyleModelStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "training_provider" VARCHAR(100),
    "external_training_job_id" VARCHAR(255),
    "storage_key" VARCHAR(500),
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "min_sample_threshold" INTEGER NOT NULL DEFAULT 15,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "trained_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "genre_style_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genre_style_training_samples" (
    "id" UUID NOT NULL,
    "genre_style_model_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genre_style_training_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genre_style_models_genre_id_base_ai_model_id_is_active_idx" ON "genre_style_models"("genre_id", "base_ai_model_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "genre_style_models_genre_id_base_ai_model_id_version_key" ON "genre_style_models"("genre_id", "base_ai_model_id", "version");

-- CreateIndex
CREATE INDEX "genre_style_training_samples_genre_style_model_id_idx" ON "genre_style_training_samples"("genre_style_model_id");

-- CreateIndex
CREATE INDEX "generation_jobs_genre_style_model_id_idx" ON "generation_jobs"("genre_style_model_id");

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_genre_style_model_id_fkey" FOREIGN KEY ("genre_style_model_id") REFERENCES "genre_style_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genre_style_models" ADD CONSTRAINT "genre_style_models_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genre_style_models" ADD CONSTRAINT "genre_style_models_base_ai_model_id_fkey" FOREIGN KEY ("base_ai_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genre_style_models" ADD CONSTRAINT "genre_style_models_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genre_style_training_samples" ADD CONSTRAINT "genre_style_training_samples_genre_style_model_id_fkey" FOREIGN KEY ("genre_style_model_id") REFERENCES "genre_style_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_primary_genre_id_fkey" FOREIGN KEY ("primary_genre_id") REFERENCES "genres"("id") ON DELETE SET NULL ON UPDATE CASCADE;
