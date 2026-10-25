-- MF-2 back office (plans, prices, Coin ledger, rewards, reports). The seed only fills the matrix of a role that has
-- no permission yet, so a database whose Admin and Staff were seeded before MF-2 never got these keys: the Admin
-- could not save the check-in ladder or the reward wheel (403 reward.rule.manage). A fresh database is left to the seed.
INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'ADMIN', p."key"
FROM "permissions" p
WHERE p."key" IN (
    'access.episode.read', 'wallet.read',
    'billing.plan.manage', 'billing.price.manage', 'billing.subscription.read', 'billing.subscription.cancel',
    'coin.wallet.read', 'coin.adjust', 'coin.transaction.read',
    'reward.rule.manage', 'analytics.revenue.read', 'analytics.churn.read'
  )
  AND EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'ADMIN')
ON CONFLICT DO NOTHING;

-- Staff reads members' wallets, Coin ledger and subscriptions (read-only).
INSERT INTO "role_permissions" ("role", "permission_key")
SELECT 'STAFF', p."key"
FROM "permissions" p
WHERE p."key" IN ('access.episode.read', 'wallet.read', 'coin.wallet.read', 'coin.transaction.read', 'billing.subscription.read')
  AND EXISTS (SELECT 1 FROM "role_permissions" WHERE "role" = 'STAFF')
ON CONFLICT DO NOTHING;
