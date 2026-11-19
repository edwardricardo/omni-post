/**
 * @file adminSystemRoles.ts
 * @description The one definition of the `SUPER_ADMIN` administration role: its row and the
 *   permissions it is granted, so every writer of the role writes the same values. It holds that
 *   role alone: the other administration roles have a single writer, the development seed, and stay
 *   there. It is plain data and imports nothing, so `@infra/prisma` takes no dependency for it; its
 *   permissions are every wire string of the `Permission` enum of `@core/domain`, as a test holds.
 * @layer infrastructure
 */

/** The shape of an administration system role as it is written to the `Role` table. */
export interface AdminSystemRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
}

/** The `SUPER_ADMIN` role and the permissions written as its `RolePermission` rows. */
export const SUPER_ADMIN_ROLE = {
  id: "role-super-admin",
  name: "SUPER_ADMIN",
  description: "Full system access with all permissions",
  level: 100,
  isSystem: true,
  permissions: [
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
    "dashboard:view",
    "post:manage",
    "secrets:view",
    "channels:force_reauth",
    "webhooks:rotate_secret",
    "oidc:replace_secret",
    "apikeys:admin_rotate",
    "providers:mass_force_reauth",
  ],
} as const satisfies AdminSystemRole;
