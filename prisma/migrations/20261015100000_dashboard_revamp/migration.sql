-- Reviewer/Creator dashboard revamp: synopsis files beside idea files, a phone number on the account,
-- and the Creator's request to the Reviewer for more production-fee Token.
CREATE TYPE "IdeaFilePurpose" AS ENUM ('IDEA', 'SYNOPSIS');

ALTER TABLE "movie_idea_files" ADD COLUMN "purpose" "IdeaFilePurpose" NOT NULL DEFAULT 'IDEA';

ALTER TABLE "users" ADD COLUMN "phone_number" VARCHAR(20);

CREATE TYPE "TokenRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

CREATE TABLE "token_requests" (
    "id" UUID NOT NULL,
    "movie_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "requested_tokens" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TokenRequestStatus" NOT NULL DEFAULT 'OPEN',
    "granted_tokens" BIGINT,
    "reviewer_response" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "token_requests_movie_id_status_idx" ON "token_requests"("movie_id", "status");
CREATE INDEX "token_requests_requested_by_id_created_at_idx" ON "token_requests"("requested_by_id", "created_at");

ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "token_requests" ADD CONSTRAINT "token_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written guards, in the style of the rest of the schema.
ALTER TABLE "token_requests"
    ADD CONSTRAINT "token_requests_amount_check" CHECK ("requested_tokens" > 0),
    ADD CONSTRAINT "token_requests_resolution_check" CHECK (
        ("status" = 'OPEN' AND "resolved_at" IS NULL AND "granted_tokens" IS NULL)
        OR ("status" = 'APPROVED' AND "resolved_at" IS NOT NULL AND "granted_tokens" > 0)
        OR ("status" = 'REJECTED' AND "resolved_at" IS NOT NULL AND "reviewer_response" IS NOT NULL)
    );