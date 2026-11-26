-- MF-2: the Admin no longer corrects a Coin balance by hand (POST /admin/wallet-adjustments is gone). Refunding a
-- whole Coin payment stays, under its own key: every role that held coin.adjust now holds coin.refund. Data only;
-- past ADJUSTMENT ledger rows stay as they are.
INSERT INTO "permissions" ("key", "area", "description") VALUES
    ('coin.refund', 'coin', 'Refund a whole Coin payment (an episode unlock or a plan payment) back to the wallet')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT "role", 'coin.refund' FROM "role_permissions" WHERE "permission_key" = 'coin.adjust'
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions" WHERE "permission_key" = 'coin.adjust';
DELETE FROM "permissions" WHERE "key" = 'coin.adjust';
