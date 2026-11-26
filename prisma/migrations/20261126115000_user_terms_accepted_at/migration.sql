-- MF-2 (2026-11-26): the time a member accepted the terms of use at sign-up. Email sign-up and a first Google
-- sign-in both require it and record it the same way. Accounts opened before this column stay NULL.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(6);
