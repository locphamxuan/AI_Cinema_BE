-- The link the Studio Web last mailed for each episode of a hand-off (BR-58): shown to the Creator, who downloads
-- it or imports it as the Submission.
CREATE TABLE "studio_film_links" (
    "id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "version" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "studio_film_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_film_links_handoff_id_episode_id_key" ON "studio_film_links"("handoff_id", "episode_id");
CREATE INDEX "studio_film_links_episode_id_idx" ON "studio_film_links"("episode_id");

ALTER TABLE "studio_film_links" ADD CONSTRAINT "studio_film_links_handoff_id_fkey" FOREIGN KEY ("handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_film_links" ADD CONSTRAINT "studio_film_links_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
