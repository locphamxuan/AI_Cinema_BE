/*
  Warnings:

  - Made the column `episode_number` on table `production_plans` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "production_plans" ALTER COLUMN "episode_number" SET NOT NULL;
