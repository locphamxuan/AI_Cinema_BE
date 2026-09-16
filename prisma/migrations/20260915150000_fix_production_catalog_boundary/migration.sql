-- CreateEnum
CREATE TYPE "ProductionContentType" AS ENUM ('MOVIE', 'SERIES');

-- CreateEnum
CREATE TYPE "EpisodeProductionStatus_new" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- AlterTable (episodes) -- simplify production status to catalog lifecycle
ALTER TABLE "episodes" ALTER COLUMN "production_status" DROP DEFAULT;
ALTER TABLE "episodes" ALTER COLUMN "production_status" TYPE "EpisodeProductionStatus_new" USING ("production_status"::text::"EpisodeProductionStatus_new");
ALTER TABLE "episodes" ALTER COLUMN "production_status" SET DEFAULT 'DRAFT';
DROP TYPE "EpisodeProductionStatus";
ALTER TYPE "EpisodeProductionStatus_new" RENAME TO "EpisodeProductionStatus";

-- AlterTable (production_projects) -- add workspace fields
ALTER TABLE "production_projects" ADD COLUMN "title" VARCHAR(255) NOT NULL,
ADD COLUMN "description" TEXT,
ADD COLUMN "content_type" "ProductionContentType" NOT NULL;

-- DropForeignKey
ALTER TABLE "production_projects" DROP CONSTRAINT "production_projects_movie_id_fkey";
ALTER TABLE "production_projects" DROP CONSTRAINT "production_projects_season_id_fkey";
ALTER TABLE "episodes" DROP CONSTRAINT "episodes_production_project_id_fkey";
ALTER TABLE "production_plans" DROP CONSTRAINT "production_plans_episode_id_fkey";
ALTER TABLE "generation_jobs" DROP CONSTRAINT "generation_jobs_episode_id_fkey";
ALTER TABLE "episode_packages" DROP CONSTRAINT "episode_packages_episode_id_fkey";

-- AlterTable (production_projects) -- remove catalog bindings
ALTER TABLE "production_projects" DROP COLUMN "movie_id";
ALTER TABLE "production_projects" DROP COLUMN "season_id";

-- AlterTable (episodes) -- remove back-link to production
ALTER TABLE "episodes" DROP COLUMN "production_project_id";

-- DropIndex
DROP INDEX "production_plans_episode_id_plan_version_key";
DROP INDEX "generation_jobs_episode_id_job_type_status_idx";
DROP INDEX "episode_packages_episode_id_package_version_key";

-- AlterTable (production_plans) -- bind plan to project
ALTER TABLE "production_plans" DROP COLUMN "episode_id";
ALTER TABLE "production_plans" ADD COLUMN "production_project_id" UUID NOT NULL,
ADD COLUMN "episode_number" INTEGER;

-- AlterTable (generation_jobs) -- remove episode dependency
ALTER TABLE "generation_jobs" DROP COLUMN "episode_id";

-- AlterTable (episode_packages) -- bind package to plan
ALTER TABLE "episode_packages" DROP COLUMN "episode_id";
ALTER TABLE "episode_packages" ADD COLUMN "production_plan_id" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_production_project_id_plan_version_key" ON "production_plans"("production_project_id", "plan_version");
CREATE INDEX "generation_jobs_production_plan_id_job_type_status_idx" ON "generation_jobs"("production_plan_id", "job_type", "status");
CREATE UNIQUE INDEX "episode_packages_production_plan_id_package_version_key" ON "episode_packages"("production_plan_id", "package_version");

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_production_project_id_fkey" FOREIGN KEY ("production_project_id") REFERENCES "production_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "episode_packages" ADD CONSTRAINT "episode_packages_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;