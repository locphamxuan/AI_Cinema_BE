-- Hearts Members give movies, and the plays of each episode, for the catalog and the Admin's film report.
CREATE TABLE "movie_likes" (
    "user_id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movie_likes_pkey" PRIMARY KEY ("user_id", "movie_id")
);

CREATE INDEX "movie_likes_movie_id_idx" ON "movie_likes"("movie_id");

ALTER TABLE "movie_likes" ADD CONSTRAINT "movie_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movie_likes" ADD CONSTRAINT "movie_likes_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "episode_views" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "episode_views_episode_id_created_at_idx" ON "episode_views"("episode_id", "created_at");
CREATE INDEX "episode_views_user_id_episode_id_created_at_idx" ON "episode_views"("user_id", "episode_id", "created_at");

ALTER TABLE "episode_views" ADD CONSTRAINT "episode_views_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_views" ADD CONSTRAINT "episode_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;