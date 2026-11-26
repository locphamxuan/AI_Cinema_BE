-- A reward prize can now be deleted for real. Each used spin keeps a copy of what it won
-- (name, type, amount), so deleting the prize only clears reward_spins.prize_id.

-- Snapshot of the prize name on the spin, backfilled from the prize it points at.
ALTER TABLE "reward_spins" ADD COLUMN "prize_name" VARCHAR(255);

UPDATE "reward_spins" AS s
SET "prize_name" = p."name",
    "prize_type" = COALESCE(s."prize_type", p."type"),
    "bonus_coins" = COALESCE(s."bonus_coins", p."bonus_coins"),
    "plan_days" = COALESCE(s."plan_days", p."plan_days")
FROM "reward_prizes" AS p
WHERE s."prize_id" = p."id";

-- Deleting a prize clears the link instead of being refused.
ALTER TABLE "reward_spins" DROP CONSTRAINT "reward_spins_prize_id_fkey";
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "reward_prizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written CHECK (Prisma does not model it; keep it when generating later migrations).
-- A used spin must carry its snapshot; the prize row itself may be gone.
ALTER TABLE "reward_spins" DROP CONSTRAINT "reward_spins_used_check";
ALTER TABLE "reward_spins" ADD CONSTRAINT "reward_spins_used_check" CHECK (
  "status" = 'AVAILABLE' OR ("prize_type" IS NOT NULL AND "prize_name" IS NOT NULL AND "spun_at" IS NOT NULL)
);
