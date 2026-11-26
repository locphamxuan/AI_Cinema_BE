-- MF-1 (2026-11-24): the budget ceiling a round prints is fixed when its first side signs, so the FINAL copy prints
-- the same ceiling as the copy signed first even if the budget moved in between. Rounds signed before keep NULL.
ALTER TABLE "contracts" ADD COLUMN "ceiling_vnd" BIGINT;

-- CHECK (hand-written, invisible to `prisma migrate diff`): a recorded ceiling belongs to a priced round and is
-- never below the cost it prints.
ALTER TABLE "contracts"
    ADD CONSTRAINT "contracts_ceiling_check" CHECK ("ceiling_vnd" IS NULL OR ("cost_vnd" IS NOT NULL AND "cost_vnd" <= "ceiling_vnd"));
