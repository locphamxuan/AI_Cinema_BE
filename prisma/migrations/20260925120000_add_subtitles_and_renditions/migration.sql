-- AlterTable: languages every episode of a project must ship subtitles in.
ALTER TABLE "production_projects" ADD COLUMN     "subtitle_languages" TEXT[] DEFAULT ARRAY['vi']::TEXT[];

-- Plans created before this carried no language; they inherit their project's.
UPDATE "production_plans" AS plan
SET "target_languages" = project."subtitle_languages"
FROM "production_projects" AS project
WHERE project."id" = plan."production_project_id" AND cardinality(plan."target_languages") = 0;

-- AlterTable: output language of a SUBTITLE/TRANSLATION job.
ALTER TABLE "generation_jobs" ADD COLUMN     "language" VARCHAR(10);

-- AlterTable: the transcoded final cut of a package (LI-02).
ALTER TABLE "episode_packages" ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "qualities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stream_url" VARCHAR(500);

-- AlterTable: renditions a catalog episode offers viewers.
ALTER TABLE "episodes" ADD COLUMN     "qualities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable: WebVTT track of an assembled package, one per language.
CREATE TABLE "episode_package_subtitles" (
    "id" UUID NOT NULL,
    "episode_package_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "episode_package_subtitles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "episode_package_subtitles_episode_package_id_language_key" ON "episode_package_subtitles"("episode_package_id", "language");

-- AddForeignKey
ALTER TABLE "episode_package_subtitles" ADD CONSTRAINT "episode_package_subtitles_episode_package_id_fkey" FOREIGN KEY ("episode_package_id") REFERENCES "episode_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
