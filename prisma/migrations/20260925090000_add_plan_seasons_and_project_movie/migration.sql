-- AlterTable: seasons and the Reviewer's allotted duration per episode plan.
ALTER TABLE "production_plans" ADD COLUMN     "allotted_duration_seconds" INTEGER,
ADD COLUMN     "season_episode_number" INTEGER,
ADD COLUMN     "season_number" INTEGER NOT NULL DEFAULT 1;

-- Existing plans are single-season: the in-season number is the running number,
-- and the allotted duration is the project's default episode duration.
UPDATE "production_plans" AS plan
SET "season_episode_number" = plan."episode_number",
    "allotted_duration_seconds" = project."default_episode_duration_seconds"
FROM "production_projects" AS project
WHERE project."id" = plan."production_project_id";

ALTER TABLE "production_plans" ALTER COLUMN "season_episode_number" SET NOT NULL;

-- AlterTable: the catalog movie a project publishes into.
ALTER TABLE "production_projects" ADD COLUMN     "movie_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "production_projects_movie_id_key" ON "production_projects"("movie_id");

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
