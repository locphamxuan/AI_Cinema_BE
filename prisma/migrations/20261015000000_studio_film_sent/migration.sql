-- The Studio Web reports each film it mails back to the Creator (BR-58); the Studio tab shows it.
ALTER TABLE "studio_handoffs"
  ADD COLUMN "film_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN "film_sent_note" TEXT;
