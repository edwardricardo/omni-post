/**
 * @file apiClient.ts
 * @description Facade for the admin app's API surface. Composes 7 per-domain
 *              clients (Health, legacy Posts, Dashboard, Audit, Auth, MFA,
 *              RBAC) into the single `api` object used across the admin app,
 *              preserving the existing nested shape (`api.admin.X`,
 *              `api.audit.X`, `api.security.mfa.X`, `api.security.rbac.X`).
 *              Types are re-exported for consumers that import them from
 *              `@/lib/apiClient`.
 * @layer infrastructure
 */

import { auditClient } from "./api/clients/auditClient";
import { authClient } from "./api/clients/authClient";
import { dashboardClient } from "./api/clients/dashboardClient";
import { healthClient } from "./api/clients/healthClient";
import { mfaClient } from "./api/clients/mfaClient";
import { rbacClient } from "./api/clients/rbacClient";
import { secretsClient } from "./api/clients/secretsClient";
import { channelsAdminClient } from "./api/clients/channelsAdminClient";
import { webhooksAdminClient } from "./api/clients/webhooksAdminClient";
import { oidcAdminClient } from "./api/clients/oidcAdminClient";
import { apiKeysAdminClient } from "./api/clients/apiKeysAdminClient";
import { providersAdminClient } from "./api/clients/providersAdminClient";

// Re-export types so existing consumers continue to import from "@/lib/apiClient".
export type {
  AccountSummary,
  AuditLog,
  AuditLogFilters,
  DashboardStats,
  RbacHierarchy,
  RoleInfo,
  SecurityStats,
} from "./api/types";

/**
 * @const api
 * @description Flat facade preserving the legacy nested API. Each property is
 *              backed by a per-domain client; this object only re-exposes
 *              their methods.
 */
export const api = {
  // Health
  health: healthClient.health,

  // Admin Dashboard
  admin: {
    getDashboardStats: dashboardClient.getDashboardStats,
    getAccountSummary: dashboardClient.getAccountSummary,
    getAccounts: dashboardClient.getAccounts,
    getAccountProjects: dashboardClient.getAccountProjects,
    getSubscriptionSummary: dashboardClient.getSubscriptionSummary,
  },

  // Audit
  audit: {
    getLogs: auditClient.getLogs,
    getStats: auditClient.getStats,
  },

  // Security — Auth + MFA + RBAC
  security: {
    login: authClient.login,
    mfa: {
      getStatus: mfaClient.getStatus,
      setup: mfaClient.setup,
      verifySetup: mfaClient.verifySetup,
      disable: mfaClient.disable,
      regenerateBackupCodes: mfaClient.regenerateBackupCodes,
      getUserStatus: mfaClient.getUserStatus,
      forceDisable: mfaClient.forceDisable,
    },
    rbac: {
      getPermissions: rbacClient.getPermissions,
      getRoles: rbacClient.getRoles,
      getRole: rbacClient.getRole,
      getUsersByRole: rbacClient.getUsersByRole,
      updateUserRole: rbacClient.updateUserRole,
      assignPermission: rbacClient.assignPermission,
      revokePermission: rbacClient.revokePermission,
      createRole: rbacClient.createRole,
      updateRole: rbacClient.updateRole,
      setRolePermissions: rbacClient.setRolePermissions,
      deleteRole: rbacClient.deleteRole,
      checkPermissions: rbacClient.checkPermissions,
      getHierarchy: rbacClient.getHierarchy,
      getStatus: rbacClient.getStatus,
    },
    secrets: {
      getRotationStatus: secretsClient.getRotationStatus,
    },
    channels: {
      forceReauth: channelsAdminClient.forceReauth,
    },
    webhooks: {
      rotateSecret: webhooksAdminClient.rotateSecret,
    },
    oidc: {
      replaceClientSecret: oidcAdminClient.replaceClientSecret,
    },
    apiKeys: {
      rotate: apiKeysAdminClient.rotate,
    },
    providers: {
      forceMassReauth: providersAdminClient.forceMassReauth,
    },
  },
};
