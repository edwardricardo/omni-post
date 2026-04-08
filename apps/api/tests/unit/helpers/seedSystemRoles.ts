/**
 * @file seedSystemRoles.ts
 * @description Seeds the in-memory role and rolePermission stores with the
 *              system roles needed for RBAC tests.
 * @layer test-infrastructure
 */

import type { MockPrismaStores } from "./mockPrisma.js";

/** All permissions in the system (mirrors the Permission enum). */
const ALL_PERMISSIONS = [
  "user:create",
  "user:read",
  "user:update",
  "user:delete",
  "user:manage_roles",
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "content:create",
  "content:read",
  "content:update",
  "content:delete",
  "content:publish",
  "analytics:read",
  "analytics:export",
  "system:configure",
  "system:monitor",
  "system:backup",
  "audit:read",
  "audit:export",
  "billing:read",
  "billing:manage",
  "ai:use",
  "ai:configure",
  "support:read",
  "support:respond",
];

const ADMIN_PERMISSIONS = [
  "user:create",
  "user:read",
  "user:update",
  "user:delete",
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "content:create",
  "content:read",
  "content:update",
  "content:delete",
  "content:publish",
  "analytics:read",
  "analytics:export",
  "system:monitor",
  "audit:read",
  "billing:read",
  "billing:manage",
  "ai:use",
  "support:read",
  "support:respond",
];

const SUPPORT_PERMISSIONS = [
  "user:read",
  "project:read",
  "content:read",
  "analytics:read",
  "support:read",
  "support:respond",
  "ai:use",
];

interface RoleDef {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  permissions: string[];
}

const SYSTEM_ROLES: RoleDef[] = [
  {
    id: "role-super-admin",
    name: "SUPER_ADMIN",
    description: "Full system access with all permissions",
    level: 100,
    isSystem: true,
    isActive: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    id: "role-admin",
    name: "ADMIN",
    description: "Administrative access with content and user management capabilities",
    level: 50,
    isSystem: true,
    isActive: true,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    id: "role-support",
    name: "SUPPORT",
    description: "Limited access for customer support operations",
    level: 10,
    isSystem: true,
    isActive: true,
    permissions: SUPPORT_PERMISSIONS,
  },
];

/**
 * Seed the mock stores with the 3 system roles and their permissions.
 * Call this in `beforeAll` / `beforeEach` of any test that needs RBAC.
 */
export function seedSystemRoles(stores: MockPrismaStores): void {
  // Clear existing role data
  stores.role.clear();
  stores.rolePermission.clear();

  for (const roleDef of SYSTEM_ROLES) {
    stores.role.add({
      id: roleDef.id,
      name: roleDef.name,
      description: roleDef.description,
      level: roleDef.level,
      isSystem: roleDef.isSystem,
      isActive: roleDef.isActive,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    });

    for (let i = 0; i < roleDef.permissions.length; i++) {
      stores.rolePermission.add({
        id: `rp-${roleDef.id}-${i}`,
        roleId: roleDef.id,
        permission: roleDef.permissions[i],
        createdAt: new Date("2024-01-01T00:00:00Z"),
      });
    }
  }
}

/** Get the roleId for a given role name. */
export function getRoleId(roleName: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: "role-super-admin",
    ADMIN: "role-admin",
    SUPPORT: "role-support",
  };
  return map[roleName] ?? `role-${roleName.toLowerCase()}`;
}
