-- The product only sells the free registered-member tier and paid monthly plans.
-- Keep historical plan rows for subscription/audit references, but hide legacy weekly/yearly plans.
-- Pending quotes are cancelled; paid periods stay usable until their period end without renewing.
UPDATE "subscriptions" AS s
SET "status" = 'CANCELLED',
    "auto_renew" = false,
    "cancelled_at" = now(),
    "ended_at" = now(),
    "end_reason" = 'CANCELLED_BY_ADMIN',
    "next_renewal_at" = null
FROM "membership_plans" AS p
WHERE s."plan_id" = p."id"
  AND p."is_free" = false
  AND p."period"::text <> 'MONTHLY'
  AND s."status"::text = 'PENDING';

UPDATE "subscriptions" AS s
SET "status" = 'EXPIRED',
    "auto_renew" = false,
    "ended_at" = now(),
    "end_reason" = 'PAYMENT_FAILED',
    "next_renewal_at" = null
FROM "membership_plans" AS p
WHERE s."plan_id" = p."id"
  AND p."is_free" = false
  AND p."period"::text <> 'MONTHLY'
  AND s."status"::text = 'PAST_DUE';

UPDATE "subscriptions" AS s
SET "auto_renew" = false,
    "cancel_requested_at" = coalesce(s."cancel_requested_at", now()),
    "next_renewal_at" = null
FROM "membership_plans" AS p
WHERE s."plan_id" = p."id"
  AND p."is_free" = false
  AND p."period"::text <> 'MONTHLY'
  AND s."status"::text = 'ACTIVE';

UPDATE "membership_plans"
SET "is_active" = false
WHERE "is_free" = false
  AND "period"::text <> 'MONTHLY';
