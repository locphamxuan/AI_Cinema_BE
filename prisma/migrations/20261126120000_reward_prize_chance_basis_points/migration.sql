-- BR-09 (26/11/2026): the Admin now types each prize's winning chance in percent. `reward_prizes.weight` keeps
-- its name and type but means basis points from now on (1 = 0.01 %, 10 000 = 100 %), and the prizes switched on
-- must add up to exactly 10 000 (checked by the API under a lock on the wheel). Data only, plus a range CHECK.
--
-- Today's weights are relative numbers, so each is turned into its share of the active total. Prizes that are
-- switched off use the same scale (or the total of every prize when none is on), kept within 1..10 000.
WITH base AS (
    SELECT COALESCE(NULLIF(SUM("weight") FILTER (WHERE "is_active"), 0), NULLIF(SUM("weight"), 0)) AS total
    FROM "reward_prizes"
)
UPDATE "reward_prizes" p
SET "weight" = LEAST(10000, GREATEST(1, ROUND(p."weight" * 10000.0 / b.total)))::int
FROM base b
WHERE NOT p."is_active" AND b.total IS NOT NULL;

-- Active prizes: largest remainder, so their basis points add up to exactly 10 000.
WITH base AS (
    SELECT SUM("weight") AS total FROM "reward_prizes" WHERE "is_active"
),
exact AS (
    SELECT p."id", p."weight" * 10000.0 / b.total AS share
    FROM "reward_prizes" p, base b
    WHERE p."is_active" AND b.total > 0
),
ranked AS (
    SELECT "id", FLOOR(share)::int AS floor_bp,
           ROW_NUMBER() OVER (ORDER BY share - FLOOR(share) DESC, "id") AS place
    FROM exact
),
shortfall AS (
    SELECT 10000 - SUM(floor_bp) AS missing FROM ranked
)
UPDATE "reward_prizes" p
SET "weight" = GREATEST(1, r.floor_bp + CASE WHEN r.place <= s.missing THEN 1 ELSE 0 END)
FROM ranked r, shortfall s
WHERE p."id" = r."id";

-- Hand-written CHECK (not visible to `prisma migrate diff`): a chance is between 0.01 % and 100 %.
ALTER TABLE "reward_prizes" ADD CONSTRAINT "reward_prizes_weight_range_check" CHECK ("weight" BETWEEN 1 AND 10000);
