-- Studio portal (2026-10-02): the studio answers a hand-off and delivers episodes itself through a
-- private link sent with the brief; no account is created for it.

-- CreateEnum
CREATE TYPE "StudioResponse" AS ENUM ('ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "studio_handoff_id" UUID,
ALTER COLUMN "submitted_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "studio_handoffs" ADD COLUMN     "decline_reason" TEXT,
ADD COLUMN     "portal_revoked_at" TIMESTAMPTZ(6),
ADD COLUMN     "portal_token_hash" CHAR(64),
ADD COLUMN     "responded_at" TIMESTAMPTZ(6),
ADD COLUMN     "studio_response" "StudioResponse";

-- CreateIndex
CREATE INDEX "media_assets_studio_handoff_id_idx" ON "media_assets"("studio_handoff_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_handoffs_portal_token_hash_key" ON "studio_handoffs"("portal_token_hash");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_studio_handoff_id_fkey" FOREIGN KEY ("studio_handoff_id") REFERENCES "studio_handoffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs are invisible to `prisma migrate diff`, so prisma/schema does not carry them.
-- A delivery comes from exactly one side: the Creator (on the studio's behalf) or the studio's link.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_one_submitter"
    CHECK (num_nonnulls("submitted_by_id", "studio_handoff_id") = 1);

-- A studio that declines says why; an answer always has its time.
ALTER TABLE "studio_handoffs" ADD CONSTRAINT "studio_handoffs_response_complete"
    CHECK (
        ("studio_response" IS NULL AND "responded_at" IS NULL)
        OR ("studio_response" = 'ACCEPTED' AND "responded_at" IS NOT NULL)
        OR ("studio_response" = 'DECLINED' AND "responded_at" IS NOT NULL AND "decline_reason" IS NOT NULL)
    );
