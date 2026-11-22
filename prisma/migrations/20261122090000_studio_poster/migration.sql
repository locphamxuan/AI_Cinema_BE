-- The poster image a studio sends with its film (22/11/2026): stored privately, downloaded by the Reviewer/Admin.
ALTER TABLE "movie_projects" ADD COLUMN "studio_poster_key" VARCHAR(500),
ADD COLUMN "studio_poster_file_name" VARCHAR(255),
ADD COLUMN "studio_poster_mime_type" VARCHAR(100),
ADD COLUMN "studio_poster_uploaded_at" TIMESTAMPTZ(6);
