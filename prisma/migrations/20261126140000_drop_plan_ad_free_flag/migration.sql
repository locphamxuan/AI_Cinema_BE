-- A running plan is always ad-free (owner rule, 26/11), so the old per-plan flag is dropped from the stored features.
UPDATE "membership_plans" SET "features" = "features" - 'adFree' WHERE "features" ? 'adFree';
