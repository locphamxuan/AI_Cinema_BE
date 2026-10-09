-- Reviewer milestones per episode (2026-10-02): the Reviewer sets when each episode must be done when
-- creating the project; the Creator's studio due date can never be later.

ALTER TABLE "episodes" ADD COLUMN "milestone_date" DATE;

-- Existing projects: the studio deadline already agreed is the best milestone there is.
UPDATE "episodes" SET "milestone_date" = "due_date" WHERE "due_date" IS NOT NULL;

-- `prisma migrate diff` does not see CHECKs, so prisma/schema only carries the column.
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_due_date_within_milestone"
    CHECK ("due_date" IS NULL OR "milestone_date" IS NULL OR "due_date" <= "milestone_date");
