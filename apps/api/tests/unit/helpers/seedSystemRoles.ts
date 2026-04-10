/**
 * @file seedSystemRoles.ts
 * @description Seeds the in-memory role and rolePermission stores with the
 *              system roles needed for RBAC tests.
 * @layer test-infrastructure
 */

import type { MockPrismaStores } from "./mockPrisma.js";

/** All permissions in the system (mirrors the Permission enum). */
const ALL_PERMISSIONS = [
  "user:read",
  "user:manage",
  "user:manage_roles",
  "account:read",
  "account:manage",
  "billing:read",
  "billing:manage",

  "pricing:manage",
  "analytics:read",
  "analytics:export",
  "system:configure",
  "system:monitor",
  "audit:read",
  "audit:export",
  "webhook:manage",
];

const ADMIN_PERMISSIONS = [
  "user:read",
  "user:manage",
  "account:read",
  "account:manage",
  "billing:read",
  "billing:manage",

  "analytics:read",
  "analytics:export",
  "system:monitor",
  "audit:read",
  "webhook:manage",
];

const SUPPORT_PERMISSIONS = [
  "user:read",
  "account:read",
  "billing:read",
  "analytics:read",
  "audit:read",
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
    description: "Administrative access with account and user management capabilities",
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
