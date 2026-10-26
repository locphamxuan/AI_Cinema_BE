-- A session belongs to a member (user_id) or a guest (guest_key), never both and never neither.
-- Hand-written: prisma migrate diff does not see CHECK constraints, so never drop it in a new migration.
ALTER TABLE "streaming_sessions" ADD CONSTRAINT "streaming_sessions_owner_check"
  CHECK (("user_id" IS NULL) <> ("guest_key" IS NULL));
