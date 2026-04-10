-- RBAC Permission Cleanup: Remove unused permissions, consolidate, add new ones

-- 1. Delete permissions that no longer exist
DELETE FROM "RolePermission" WHERE permission IN (
  'project:create', 'project:read', 'project:update', 'project:delete',
  'content:create', 'content:read', 'content:update', 'content:delete', 'content:publish',
  'ai:use', 'ai:configure',
  'support:read', 'support:respond',
  'system:backup'
);

-- 2. Consolidate user:create + user:update + user:delete -> user:manage
INSERT INTO "RolePermission" (id, "roleId", permission)
SELECT gen_random_uuid()::text, rp."roleId", 'user:manage'
FROM "RolePermission" rp
WHERE rp.permission IN ('user:create', 'user:update', 'user:delete')
GROUP BY rp."roleId"
ON CONFLICT ("roleId", permission) DO NOTHING;

DELETE FROM "RolePermission" WHERE permission IN ('user:create', 'user:update', 'user:delete');

-- 3. Add new permissions to SUPER_ADMIN (role-super-admin)
INSERT INTO "RolePermission" (id, "roleId", permission)
VALUES
  (gen_random_uuid()::text, 'role-super-admin', 'account:read'),
  (gen_random_uuid()::text, 'role-super-admin', 'account:manage'),
  (gen_random_uuid()::text, 'role-super-admin', 'pricing:manage'),
  (gen_random_uuid()::text, 'role-super-admin', 'webhook:manage')
ON CONFLICT ("roleId", permission) DO NOTHING;

-- 4. Ensure ADMIN has all expected permissions (new + retained)
INSERT INTO "RolePermission" (id, "roleId", permission)
VALUES
  (gen_random_uuid()::text, 'role-admin', 'user:manage'),
  (gen_random_uuid()::text, 'role-admin', 'account:read'),
  (gen_random_uuid()::text, 'role-admin', 'account:manage'),
  (gen_random_uuid()::text, 'role-admin', 'billing:read'),
  (gen_random_uuid()::text, 'role-admin', 'billing:manage'),
  (gen_random_uuid()::text, 'role-admin', 'analytics:read'),
  (gen_random_uuid()::text, 'role-admin', 'analytics:export'),
  (gen_random_uuid()::text, 'role-admin', 'audit:read'),
  (gen_random_uuid()::text, 'role-admin', 'webhook:manage')
ON CONFLICT ("roleId", permission) DO NOTHING;

-- 5. Add new permissions to SUPPORT (role-support)
INSERT INTO "RolePermission" (id, "roleId", permission)
VALUES
  (gen_random_uuid()::text, 'role-support', 'account:read'),
  (gen_random_uuid()::text, 'role-support', 'billing:read'),
  (gen_random_uuid()::text, 'role-support', 'audit:read')
ON CONFLICT ("roleId", permission) DO NOTHING;
