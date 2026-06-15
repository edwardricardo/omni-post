/**
 * @file rbacClient.ts
 * @description Role-Based Access Control endpoints — list/manage roles,
 *              assign/revoke permissions, change user roles, and read the
 *              hierarchy and aggregated security stats.
 * @layer infrastructure
 */

import type {
  CreateRoleInput,
  RbacHierarchy,
  RoleInfo,
  SecurityStats,
  UpdateRoleInput,
  UserPermissions,
} from "../types.js";
import { http } from "./http.js";

/**
 * @const rbacClient
 * @description Methods for `/auth/permissions*` and `/admin/rbac/*`.
 */
export const rbacClient = {
  getPermissions: () => http<{ ok: boolean } & UserPermissions>("/auth/permissions"),

  getRoles: () =>
    http<{ ok: boolean; roles: RoleInfo[]; permissionCategories: Record<string, string[]> }>(
      "/admin/rbac/roles"
    ),

  getRole: (role: string) => http<{ ok: boolean; role: RoleInfo }>(`/admin/rbac/roles/${role}`),

  getUsersByRole: (role: string) =>
    http<{ ok: boolean; users: unknown[]; count: number }>(`/admin/rbac/roles/${role}/users`),

  updateUserRole: (userId: string, role: string, reason: string) =>
    http<{ ok: boolean }>(`/admin/rbac/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role, reason }),
    }),

  assignPermission: (role: string, permission: string) =>
    http<{ ok: boolean }>(`/admin/rbac/roles/${role}/permissions`, {
      method: "POST",
      body: JSON.stringify({ permission }),
    }),

  revokePermission: (role: string, permission: string) =>
    http<{ ok: boolean }>(`/admin/rbac/roles/${role}/permissions/${permission}`, {
      method: "DELETE",
    }),

  createRole: (data: CreateRoleInput) =>
    http<{ ok: boolean; role: unknown }>("/admin/rbac/roles", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateRole: (roleId: string, data: UpdateRoleInput) =>
    http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  setRolePermissions: (roleId: string, permissions: string[]) =>
    http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissions }),
    }),

  deleteRole: (roleId: string) =>
    http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}`, {
      method: "DELETE",
    }),

  checkPermissions: (permissions: string[], requireAll = false) =>
    http<{ ok: boolean; hasAccess: boolean; permissions: unknown }>("/auth/permissions/check", {
      method: "POST",
      body: JSON.stringify({ permissions, requireAll }),
    }),

  getHierarchy: () => http<{ ok: boolean } & RbacHierarchy>("/admin/rbac/hierarchy"),

  getStatus: () => http<{ ok: boolean } & SecurityStats>("/admin/rbac/status"),
};
