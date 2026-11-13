-- 2026-11-13: the AI Support migration added no permission rows, so databases seeded before it (Neon) had
-- no support:* keys and every Member got 403 on the chatbox. Adds the keys and the default grants; idempotent.
INSERT INTO "permissions" ("key", "area", "description") VALUES
    ('support:chat', 'support', 'Member mở chat hỗ trợ'),
    ('support:case.read', 'support', 'Staff/ADMIN đọc support case'),
    ('support:case.manage', 'support', 'Staff manage case: claim, reply, resolve, close'),
    ('support:case.assign', 'support', 'ADMIN gán case cho Staff'),
    ('support:knowledge.manage', 'support', 'Admin quản lý Knowledge Base')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT grant_role::"UserRole", grant_key FROM (VALUES
    ('MEMBER', 'support:chat'),
    ('STAFF', 'support:case.read'),
    ('STAFF', 'support:case.manage'),
    ('ADMIN', 'support:case.read'),
    ('ADMIN', 'support:case.manage'),
    ('ADMIN', 'support:case.assign'),
    ('ADMIN', 'support:knowledge.manage')
) AS g(grant_role, grant_key)
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT DO NOTHING;
