-- "Danh sách của tôi": the movies a Member saved to watch later.
CREATE TABLE "saved_movies" (
    "user_id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_movies_pkey" PRIMARY KEY ("user_id","movie_id")
);

CREATE INDEX "saved_movies_user_id_created_at_idx" ON "saved_movies"("user_id", "created_at");

ALTER TABLE "saved_movies" ADD CONSTRAINT "saved_movies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_movies" ADD CONSTRAINT "saved_movies_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
