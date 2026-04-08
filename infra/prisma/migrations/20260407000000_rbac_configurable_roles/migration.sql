-- CreateTable: Role
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RolePermission
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE INDEX "Role_isActive_idx" ON "Role"("isActive");
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");
CREATE UNIQUE INDEX "RolePermission_roleId_permission_key" ON "RolePermission"("roleId", "permission");

-- AddForeignKey: RolePermission -> Role
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed system roles with deterministic IDs
INSERT INTO "Role" ("id", "name", "description", "level", "isSystem", "isActive", "createdAt", "updatedAt")
VALUES
  ('role-super-admin', 'SUPER_ADMIN', 'Full system access with all permissions', 100, true, true, NOW(), NOW()),
  ('role-admin', 'ADMIN', 'Administrative access with content and user management capabilities', 50, true, true, NOW(), NOW()),
  ('role-support', 'SUPPORT', 'Limited access for customer support operations', 10, true, true, NOW(), NOW());

-- Seed SUPER_ADMIN permissions (all 27)
INSERT INTO "RolePermission" ("id", "roleId", "permission", "createdAt")
VALUES
  ('rp-sa-01', 'role-super-admin', 'user:create', NOW()),
  ('rp-sa-02', 'role-super-admin', 'user:read', NOW()),
  ('rp-sa-03', 'role-super-admin', 'user:update', NOW()),
  ('rp-sa-04', 'role-super-admin', 'user:delete', NOW()),
  ('rp-sa-05', 'role-super-admin', 'user:manage_roles', NOW()),
  ('rp-sa-06', 'role-super-admin', 'project:create', NOW()),
  ('rp-sa-07', 'role-super-admin', 'project:read', NOW()),
  ('rp-sa-08', 'role-super-admin', 'project:update', NOW()),
  ('rp-sa-09', 'role-super-admin', 'project:delete', NOW()),
  ('rp-sa-10', 'role-super-admin', 'content:create', NOW()),
  ('rp-sa-11', 'role-super-admin', 'content:read', NOW()),
  ('rp-sa-12', 'role-super-admin', 'content:update', NOW()),
  ('rp-sa-13', 'role-super-admin', 'content:delete', NOW()),
  ('rp-sa-14', 'role-super-admin', 'content:publish', NOW()),
  ('rp-sa-15', 'role-super-admin', 'analytics:read', NOW()),
  ('rp-sa-16', 'role-super-admin', 'analytics:export', NOW()),
  ('rp-sa-17', 'role-super-admin', 'system:configure', NOW()),
  ('rp-sa-18', 'role-super-admin', 'system:monitor', NOW()),
  ('rp-sa-19', 'role-super-admin', 'system:backup', NOW()),
  ('rp-sa-20', 'role-super-admin', 'audit:read', NOW()),
  ('rp-sa-21', 'role-super-admin', 'audit:export', NOW()),
  ('rp-sa-22', 'role-super-admin', 'billing:read', NOW()),
  ('rp-sa-23', 'role-super-admin', 'billing:manage', NOW()),
  ('rp-sa-24', 'role-super-admin', 'ai:use', NOW()),
  ('rp-sa-25', 'role-super-admin', 'ai:configure', NOW()),
  ('rp-sa-26', 'role-super-admin', 'support:read', NOW()),
  ('rp-sa-27', 'role-super-admin', 'support:respond', NOW());

-- Seed ADMIN permissions (22)
INSERT INTO "RolePermission" ("id", "roleId", "permission", "createdAt")
VALUES
  ('rp-ad-01', 'role-admin', 'user:create', NOW()),
  ('rp-ad-02', 'role-admin', 'user:read', NOW()),
  ('rp-ad-03', 'role-admin', 'user:update', NOW()),
  ('rp-ad-04', 'role-admin', 'user:delete', NOW()),
  ('rp-ad-05', 'role-admin', 'project:create', NOW()),
  ('rp-ad-06', 'role-admin', 'project:read', NOW()),
  ('rp-ad-07', 'role-admin', 'project:update', NOW()),
  ('rp-ad-08', 'role-admin', 'project:delete', NOW()),
  ('rp-ad-09', 'role-admin', 'content:create', NOW()),
  ('rp-ad-10', 'role-admin', 'content:read', NOW()),
  ('rp-ad-11', 'role-admin', 'content:update', NOW()),
  ('rp-ad-12', 'role-admin', 'content:delete', NOW()),
  ('rp-ad-13', 'role-admin', 'content:publish', NOW()),
  ('rp-ad-14', 'role-admin', 'analytics:read', NOW()),
  ('rp-ad-15', 'role-admin', 'analytics:export', NOW()),
  ('rp-ad-16', 'role-admin', 'system:monitor', NOW()),
  ('rp-ad-17', 'role-admin', 'audit:read', NOW()),
  ('rp-ad-18', 'role-admin', 'billing:read', NOW()),
  ('rp-ad-19', 'role-admin', 'billing:manage', NOW()),
  ('rp-ad-20', 'role-admin', 'ai:use', NOW()),
  ('rp-ad-21', 'role-admin', 'support:read', NOW()),
  ('rp-ad-22', 'role-admin', 'support:respond', NOW());

-- Seed SUPPORT permissions (7)
INSERT INTO "RolePermission" ("id", "roleId", "permission", "createdAt")
VALUES
  ('rp-su-01', 'role-support', 'user:read', NOW()),
  ('rp-su-02', 'role-support', 'project:read', NOW()),
  ('rp-su-03', 'role-support', 'content:read', NOW()),
  ('rp-su-04', 'role-support', 'analytics:read', NOW()),
  ('rp-su-05', 'role-support', 'support:read', NOW()),
  ('rp-su-06', 'role-support', 'support:respond', NOW()),
  ('rp-su-07', 'role-support', 'ai:use', NOW());

-- Drop old index
DROP INDEX IF EXISTS "AdminUser_role_isActive_idx";

-- Add roleId column (nullable first for data migration)
ALTER TABLE "AdminUser" ADD COLUMN "roleId" TEXT;

-- Migrate data: map old enum role values to new Role table IDs
UPDATE "AdminUser" SET "roleId" = 'role-super-admin' WHERE "role" = 'SUPER_ADMIN';
UPDATE "AdminUser" SET "roleId" = 'role-admin' WHERE "role" = 'ADMIN';
UPDATE "AdminUser" SET "roleId" = 'role-support' WHERE "role" = 'SUPPORT';

-- Make roleId NOT NULL now that data is migrated
ALTER TABLE "AdminUser" ALTER COLUMN "roleId" SET NOT NULL;

-- Drop old role column
ALTER TABLE "AdminUser" DROP COLUMN "role";

-- Drop old AdminRole enum
DROP TYPE "AdminRole";

-- Add foreign key constraint
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add new index
CREATE INDEX "AdminUser_roleId_isActive_idx" ON "AdminUser"("roleId", "isActive");
