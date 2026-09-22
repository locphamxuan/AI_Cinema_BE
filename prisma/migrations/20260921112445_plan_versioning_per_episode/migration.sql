/*
  Warnings:

  - A unique constraint covering the columns `[production_project_id,episode_number,plan_version]` on the table `production_plans` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "production_plans_production_project_id_plan_version_key";

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_production_project_id_episode_number_plan__key" ON "production_plans"("production_project_id", "episode_number", "plan_version");
