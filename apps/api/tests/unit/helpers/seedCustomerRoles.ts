/**
 * @file seedCustomerRoles.ts
 * @description Canon-parity test seed for customer-side RBAC. Mirrors the
 *              `infra/prisma/seed.ts` definition of the 4 CustomerRoles
 *              (OWNER / MANAGER / MEMBER / VIEWER) and their 118 permissions
 *              so unit tests exercise the same shape that production seeds
 *              into the DB. Drift between this file and seed.ts is a bug —
 *              the permission lists must stay verbatim.
 * @layer infrastructure
 */

import { vi } from "vitest";
import { createStore, buildModelMock, type ModelStore } from "./mockPrisma.js";

// ---------------------------------------------------------------------------
// Canon role definitions (verbatim mirror of infra/prisma/seed.ts)
// ---------------------------------------------------------------------------

export interface CustomerRoleDef {
  readonly id: string;
  readonly name: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
  readonly description: string;
  readonly level: number;
  readonly isSystem: true;
  readonly permissions: readonly string[];
}

export const CUSTOMER_ROLES: readonly CustomerRoleDef[] = [
  {
    id: "role-owner",
    name: "OWNER",
    description: "Full access to the account, including billing and member role management",
    level: 100,
    isSystem: true,
    permissions: [
      "post:read",
      "post:create",
      "post:edit",
      "post:publish",
      "post:delete",
      "channel:read",
      "channel:connect",
      "channel:disconnect",
      "channel:manage",
      "analytics:read",
      "analytics:export",
      "member:read",
      "member:invite",
      "member:remove",
      "member:manage_roles",
      "approval:read",
      "approval:submit",
      "approval:review",
      "billing:read",
      "billing:manage",
      "account:read",
      "account:manage",
      "account:delete",
      "campaign:read",
      "campaign:create",
      "campaign:manage",
      "template:read",
      "template:create",
      "template:manage",
      "comment:read",
      "comment:create",
      "comment:moderate",
      "ai:use",
      "ai:configure",
      "compliance:read",
      "compliance:manage",
      "notification:read",
      "notification:manage",
      "inbox:read",
      "inbox:respond",
      "task:read",
      "task:create",
      "task:manage",
      "snapshot:view",
      "snapshot:create",
      "snapshot:manage",
    ],
  },
  {
    id: "role-manager",
    name: "MANAGER",
    description:
      "Operational management — everything except billing, account deletion, and role assignment",
    level: 50,
    isSystem: true,
    permissions: [
      "post:read",
      "post:create",
      "post:edit",
      "post:publish",
      "post:delete",
      "channel:read",
      "channel:connect",
      "channel:disconnect",
      "channel:manage",
      "analytics:read",
      "analytics:export",
      "member:read",
      "member:invite",
      "member:remove",
      "approval:read",
      "approval:submit",
      "approval:review",
      "billing:read",
      "account:read",
      "campaign:read",
      "campaign:create",
      "campaign:manage",
      "template:read",
      "template:create",
      "template:manage",
      "comment:read",
      "comment:create",
      "comment:moderate",
      "ai:use",
      "ai:configure",
      "compliance:read",
      "notification:read",
      "notification:manage",
      "inbox:read",
      "inbox:respond",
      "task:read",
      "task:create",
      "task:manage",
      "snapshot:view",
      "snapshot:create",
    ],
  },
  {
    id: "role-member",
    name: "MEMBER",
    description: "Day-to-day contributor — create and publish content, view analytics",
    level: 20,
    isSystem: true,
    permissions: [
      "post:read",
      "post:create",
      "post:edit",
      "post:publish",
      "channel:read",
      "analytics:read",
      "member:read",
      "approval:read",
      "approval:submit",
      "campaign:read",
      "template:read",
      "template:create",
      "comment:read",
      "comment:create",
      "ai:use",
      "notification:read",
      "inbox:read",
      "inbox:respond",
      "task:read",
      "task:create",
      "snapshot:view",
    ],
  },
  {
    id: "role-viewer",
    name: "VIEWER",
    description: "Read-only access to the account",
    level: 10,
    isSystem: true,
    permissions: [
      "post:read",
      "channel:read",
      "analytics:read",
      "member:read",
      "approval:read",
      "campaign:read",
      "template:read",
      "comment:read",
      "notification:read",
      "inbox:read",
      "task:read",
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Map a role name to its canon id (`role-owner`, ...). */
export function getCustomerRoleId(roleName: CustomerRoleDef["name"]): string {
  const role = CUSTOMER_ROLES.find((r) => r.name === roleName);
  if (!role) {
    throw new Error(`Unknown customer role: ${roleName}`);
  }
  return role.id;
}

/**
 * Build a `RoleSnapshot` payload as returned by `CustomerRoleRepository
 * .getSnapshotByName` / `.getSnapshotById`. Use in unit tests that mock the
 * repository directly (no Prisma layer).
 */
export function makeCustomerRoleSnapshot(roleName: CustomerRoleDef["name"]): {
  roleId: string;
  roleName: string;
  roleLevel: number;
  permissions: ReadonlySet<string>;
} {
  const role = CUSTOMER_ROLES.find((r) => r.name === roleName);
  if (!role) {
    throw new Error(`Unknown customer role: ${roleName}`);
  }
  return {
    roleId: role.id,
    roleName: role.name,
    roleLevel: role.level,
    permissions: new Set(role.permissions),
  };
}

// ---------------------------------------------------------------------------
// Prisma-store seeding + hydration shims
// ---------------------------------------------------------------------------

export interface CustomerRoleMocks {
  /** Backing store for the `customerRole` model. */
  customerRoleStore: ModelStore<Record<string, unknown>>;
  /** Backing store for the `customerRolePermission` model. */
  customerRolePermissionStore: ModelStore<Record<string, unknown>>;
  /**
   * Mock for `prisma.customerRole`. Pre-decorated so `findUnique` /
   * `findFirst` / `findMany` with `include: { permissions: true }` hydrate
   * the joined rows from `customerRolePermissionStore`.
   */
  customerRoleMock: ReturnType<typeof buildModelMock>;
  /**
   * Mock for `prisma.customerRolePermission`. No hydration logic needed.
   */
  customerRolePermissionMock: ReturnType<typeof buildModelMock>;
}

/**
 * Build pre-seeded mock model objects for `customerRole` +
 * `customerRolePermission` with permission-hydration shims attached. The
 * stores are pre-populated with the 4 canon roles and 118 permissions so
 * tests reading via `findUnique({where:{name:"OWNER"}, include:{permissions:true}})`
 * see exactly what production sees.
 */
export function createCustomerRoleMocks(): CustomerRoleMocks {
  const customerRoleStore = createStore<Record<string, unknown>>();
  const customerRolePermissionStore = createStore<Record<string, unknown>>();

  const now = new Date();
  for (const role of CUSTOMER_ROLES) {
    customerRoleStore.add({
      id: role.id,
      name: role.name,
      description: role.description,
      level: role.level,
      isSystem: role.isSystem,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const perm of role.permissions) {
      customerRolePermissionStore.add({
        id: `${role.id}-${perm}`,
        roleId: role.id,
        permission: perm,
        createdAt: now,
      });
    }
  }

  const customerRoleMock = buildModelMock(customerRoleStore);
  const customerRolePermissionMock = buildModelMock(customerRolePermissionStore);

  // Hydrate `permissions` when reads request the include — matches the
  // Prisma include used by PrismaCustomerUserRepository / -RoleRepository.
  const originalFindUnique = customerRoleMock.findUnique;
  customerRoleMock.findUnique = vi.fn(
    async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const result = await originalFindUnique(args);
      if (result && args.include?.permissions) {
        (result as Record<string, unknown>).permissions = customerRolePermissionStore
          .all()
          .filter((p) => p.roleId === (result as { id: string }).id);
      }
      return result;
    }
  );

  const originalFindFirst = customerRoleMock.findFirst;
  customerRoleMock.findFirst = vi.fn(
    async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const result = await originalFindFirst(args);
      if (result && args.include?.permissions) {
        (result as Record<string, unknown>).permissions = customerRolePermissionStore
          .all()
          .filter((p) => p.roleId === (result as { id: string }).id);
      }
      return result;
    }
  );

  const originalFindMany = customerRoleMock.findMany;
  customerRoleMock.findMany = vi.fn(
    async (args?: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const rows = (await originalFindMany(args ?? {})) as Record<string, unknown>[];
      if (args?.include?.permissions) {
        for (const r of rows) {
          (r as { permissions?: unknown }).permissions = customerRolePermissionStore
            .all()
            .filter((p) => p.roleId === (r as { id: string }).id);
        }
      }
      return rows;
    }
  );

  return {
    customerRoleStore,
    customerRolePermissionStore,
    customerRoleMock,
    customerRolePermissionMock,
  };
}

/**
 * Decorate an existing `prisma.customerUser` model mock so reads that pass
 * `include: { customerRole: { include: { permissions: true } } }` hydrate the
 * joined CustomerRole + its permissions from the helper's stores. Mutates
 * the passed mock in place and returns it for chaining.
 *
 * Callers MUST have constructed `customerRoleMocks` via `createCustomerRoleMocks`
 * first — the hydration reads from those stores.
 */
export function decorateCustomerUserMockWithRoleHydration(
  customerUserMock: ReturnType<typeof buildModelMock>,
  roleMocks: Pick<CustomerRoleMocks, "customerRoleStore" | "customerRolePermissionStore">
): ReturnType<typeof buildModelMock> {
  const hydrate = (user: Record<string, unknown>): void => {
    const roleId = user.roleId;
    if (roleId === undefined || roleId === null) {
      user.customerRole = null;
      return;
    }
    const role = roleMocks.customerRoleStore.all().find((r) => r.id === roleId);
    if (!role) {
      user.customerRole = null;
      return;
    }
    user.customerRole = {
      ...role,
      permissions: roleMocks.customerRolePermissionStore.all().filter((p) => p.roleId === roleId),
    };
  };

  const originalFindUnique = customerUserMock.findUnique;
  customerUserMock.findUnique = vi.fn(
    async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const result = await originalFindUnique(args);
      if (result && args.include?.customerRole) {
        hydrate(result as Record<string, unknown>);
      }
      return result;
    }
  );

  const originalFindFirst = customerUserMock.findFirst;
  customerUserMock.findFirst = vi.fn(
    async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const result = await originalFindFirst(args);
      if (result && args.include?.customerRole) {
        hydrate(result as Record<string, unknown>);
      }
      return result;
    }
  );

  const originalFindMany = customerUserMock.findMany;
  customerUserMock.findMany = vi.fn(
    async (args?: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const rows = (await originalFindMany(args ?? {})) as Record<string, unknown>[];
      if (args?.include?.customerRole) {
        for (const row of rows) {
          hydrate(row);
        }
      }
      return rows;
    }
  );

  return customerUserMock;
}
