-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "coin_price" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "stream_url" VARCHAR(500),
ADD COLUMN     "synopsis" TEXT,
ADD COLUMN     "thumbnail_url" VARCHAR(500);

-- AlterTable
ALTER TABLE "movies" ADD COLUMN     "age_rating" VARCHAR(10),
ADD COLUMN     "banner_url" VARCHAR(500),
ADD COLUMN     "poster_url" VARCHAR(500),
ADD COLUMN     "release_year" INTEGER;

