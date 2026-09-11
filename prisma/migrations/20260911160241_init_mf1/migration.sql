-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "EpisodeProductionStatus" AS ENUM ('DRAFT', 'IN_PRODUCTION', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiModality" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MULTIMODAL');

-- CreateEnum
CREATE TYPE "GenerationJobType" AS ENUM ('SCRIPT', 'IMAGE', 'VOICE', 'VIDEO', 'ASSEMBLY');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('SCRIPT_TEXT', 'IMAGE', 'VOICE_AUDIO', 'VIDEO_CLIP', 'SUBTITLE');

-- CreateEnum
CREATE TYPE "GeneratedAssetStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "EpisodePackageStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplianceCheckType" AS ENUM ('AI_LABEL', 'CONTENT_POLICY', 'COPYRIGHT', 'LEGAL');

-- CreateEnum
CREATE TYPE "ComplianceResult" AS ENUM ('PENDING', 'PASS', 'FAIL');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "defaultLanguage" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_genre" (
    "movieId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,

    CONSTRAINT "movie_genre_pkey" PRIMARY KEY ("movieId","genreId")
);

-- CreateTable
CREATE TABLE "season" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "title" TEXT,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "seasonId" TEXT,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "productionStatus" "EpisodeProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "currentPackageId" TEXT,

    CONSTRAINT "episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_brief" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "styleConfig" JSONB,
    "targetDurationSeconds" INTEGER,
    "targetLanguages" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,

    CONSTRAINT "ai_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model" (
    "id" TEXT NOT NULL,
    "aiProviderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "modality" "AiModality" NOT NULL,

    CONSTRAINT "ai_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_job" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "aiModelId" TEXT NOT NULL,
    "jobType" "GenerationJobType" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "parentJobId" TEXT,
    "configSnapshot" JSONB,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "externalJobReference" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_asset" (
    "id" TEXT NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "language" TEXT,
    "contentText" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "durationSeconds" INTEGER,
    "resolution" TEXT,
    "metadata" JSONB,
    "status" "GeneratedAssetStatus" NOT NULL DEFAULT 'PENDING',
    "isSelected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "generated_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_package" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "packageVersion" INTEGER NOT NULL,
    "assembledBy" TEXT,
    "assemblyJobId" TEXT,
    "status" "EpisodePackageStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_package_asset" (
    "episodePackageId" TEXT NOT NULL,
    "generatedAssetId" TEXT NOT NULL,

    CONSTRAINT "episode_package_asset_pkey" PRIMARY KEY ("episodePackageId","generatedAssetId")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "episodePackageId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "rejectionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_check" (
    "id" TEXT NOT NULL,
    "episodePackageId" TEXT NOT NULL,
    "checkType" "ComplianceCheckType" NOT NULL,
    "result" "ComplianceResult" NOT NULL DEFAULT 'PENDING',
    "rulesetVersion" TEXT,
    "checkedById" TEXT,
    "checkedBySystem" TEXT,
    "failureReason" TEXT,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_content_label" (
    "id" TEXT NOT NULL,
    "episodePackageId" TEXT NOT NULL,
    "labelType" TEXT NOT NULL,
    "labelText" TEXT NOT NULL,
    "displayLocation" TEXT,
    "rulesetVersion" TEXT,
    "appliedById" TEXT,

    CONSTRAINT "ai_content_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "episodePackageId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "publishedById" TEXT NOT NULL,

    CONSTRAINT "publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "genre_name_key" ON "genre"("name");

-- CreateIndex
CREATE UNIQUE INDEX "season_movieId_seasonNumber_key" ON "season"("movieId", "seasonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "episode_currentPackageId_key" ON "episode"("currentPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "episode_movieId_seasonId_episodeNumber_key" ON "episode"("movieId", "seasonId", "episodeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_name_key" ON "ai_provider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_aiProviderId_name_version_key" ON "ai_model"("aiProviderId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "episode_package_episodeId_packageVersion_key" ON "episode_package"("episodeId", "packageVersion");

-- AddForeignKey
ALTER TABLE "movie" ADD CONSTRAINT "movie_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genre" ADD CONSTRAINT "movie_genre_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genre" ADD CONSTRAINT "movie_genre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode" ADD CONSTRAINT "episode_currentPackageId_fkey" FOREIGN KEY ("currentPackageId") REFERENCES "episode_package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_brief" ADD CONSTRAINT "content_brief_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_brief" ADD CONSTRAINT "content_brief_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "ai_provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "ai_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "generation_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_asset" ADD CONSTRAINT "generated_asset_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package" ADD CONSTRAINT "episode_package_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package" ADD CONSTRAINT "episode_package_assemblyJobId_fkey" FOREIGN KEY ("assemblyJobId") REFERENCES "generation_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package_asset" ADD CONSTRAINT "episode_package_asset_episodePackageId_fkey" FOREIGN KEY ("episodePackageId") REFERENCES "episode_package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_package_asset" ADD CONSTRAINT "episode_package_asset_generatedAssetId_fkey" FOREIGN KEY ("generatedAssetId") REFERENCES "generated_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_episodePackageId_fkey" FOREIGN KEY ("episodePackageId") REFERENCES "episode_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_check" ADD CONSTRAINT "compliance_check_episodePackageId_fkey" FOREIGN KEY ("episodePackageId") REFERENCES "episode_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_check" ADD CONSTRAINT "compliance_check_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_label" ADD CONSTRAINT "ai_content_label_episodePackageId_fkey" FOREIGN KEY ("episodePackageId") REFERENCES "episode_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_content_label" ADD CONSTRAINT "ai_content_label_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication" ADD CONSTRAINT "publication_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication" ADD CONSTRAINT "publication_episodePackageId_fkey" FOREIGN KEY ("episodePackageId") REFERENCES "episode_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication" ADD CONSTRAINT "publication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
