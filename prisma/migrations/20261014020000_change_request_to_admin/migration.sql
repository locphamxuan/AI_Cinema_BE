-- The Reviewer or Creator now asks the Admin (BR-55): the answer moves from reviewer_response to admin_response.
CREATE TYPE "ChangeRequestType" AS ENUM ('PROJECT_UPDATE', 'BUDGET_SUPPLEMENT', 'DEADLINE_EXTENSION', 'OTHER');

ALTER TYPE "ChangeRequestStatus" RENAME VALUE 'ACCEPTED' TO 'APPROVED';
ALTER TABLE "project_change_requests" RENAME COLUMN "reviewer_response" TO "admin_response";

ALTER TABLE "project_change_requests" ADD COLUMN "season_id" UUID,
ADD COLUMN "request_type" "ChangeRequestType" NOT NULL DEFAULT 'PROJECT_UPDATE',
ADD COLUMN "reason" TEXT,
ADD COLUMN "requested_tokens" BIGINT,
ADD COLUMN "attachment_name" VARCHAR(255),
ADD COLUMN "attachment_key" VARCHAR(500),
ADD COLUMN "attachment_mime_type" VARCHAR(100);

-- Requests raised by the Admin before this change keep their text as the reason.
UPDATE "project_change_requests" SET "reason" = "content";
ALTER TABLE "project_change_requests" ALTER COLUMN "reason" SET NOT NULL;

ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Tokens are asked for only by a budget supplement, and the proof is stored whole or not at all.
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_tokens_check" CHECK (
    ("request_type" = 'BUDGET_SUPPLEMENT' AND "requested_tokens" > 0)
    OR ("request_type" <> 'BUDGET_SUPPLEMENT' AND "requested_tokens" IS NULL)
);
ALTER TABLE "project_change_requests" ADD CONSTRAINT "project_change_requests_attachment_check" CHECK (
    ("attachment_key" IS NULL) = ("attachment_name" IS NULL) AND ("attachment_key" IS NULL) = ("attachment_mime_type" IS NULL)
);
