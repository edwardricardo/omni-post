/**
 * @file apiClient.ts
 * @description Facade for the admin app's API surface. Composes per-domain
 *              clients (Health, Dashboard, Audit, Auth, MFA, RBAC, Secrets,
 *              Channels, Webhooks, OIDC, API keys, Providers) into the single
 *              `api` object used across the admin app, exposing them under a
 *              nested shape (`api.admin.X`, `api.audit.X`,
 *              `api.security.mfa.X`, `api.security.rbac.X`). Types are
 *              re-exported for consumers that import them from
 *              `@/lib/apiClient`.
 * @layer infrastructure
 */

import { auditClient } from "./api/clients/auditClient.js";
import { authClient } from "./api/clients/authClient.js";
import { dashboardClient } from "./api/clients/dashboardClient.js";
import { healthClient } from "./api/clients/healthClient.js";
import { mfaClient } from "./api/clients/mfaClient.js";
import { rbacClient } from "./api/clients/rbacClient.js";
import { secretsClient } from "./api/clients/secretsClient.js";
import { channelsAdminClient } from "./api/clients/channelsAdminClient.js";
import { webhooksAdminClient } from "./api/clients/webhooksAdminClient.js";
import { oidcAdminClient } from "./api/clients/oidcAdminClient.js";
import { apiKeysAdminClient } from "./api/clients/apiKeysAdminClient.js";
import { providersAdminClient } from "./api/clients/providersAdminClient.js";

// Re-export types so consumers can import them from "@/lib/apiClient".
export type {
  AccountSummary,
  AuditLog,
  AuditLogFilters,
  DashboardStats,
  RbacHierarchy,
  RoleInfo,
  SecurityStats,
} from "./api/types.js";

/**
 * @const api
 * @description Flat facade with a nested per-domain shape. Each property is
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
