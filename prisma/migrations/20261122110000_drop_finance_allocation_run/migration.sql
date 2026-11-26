-- MF-5: the Monthly-plan revenue share (BR-48) is now run only by the monthly job and shown inside the profit of
-- each film, so the Admin's manual "share this month again" route and its permission are gone. Data only.
DELETE FROM "role_permissions" WHERE "permission_key" = 'finance:allocation.run';
DELETE FROM "permissions" WHERE "key" = 'finance:allocation.run';
