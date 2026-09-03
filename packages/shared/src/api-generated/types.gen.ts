/**
 * @file types.gen.ts
 * @description AUTO-GENERATED por @hey-api/openapi-ts a partir del spec
 *   OpenAPI emitido por Fastify (`@fastify/swagger`). NO editar a mano.
 *   Regenerar con `pnpm generate:api-types`.
 *   Workstream: §3.1 Normalization Roadmap.
 * @layer infrastructure
 */
export type ClientOptions = {
  baseUrl: "http://localhost:3000" | (string & {});
};

export type GetDocsJsonData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/docs/json";
};

export type GetDocsJsonResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetHealthData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/health";
};

export type GetHealthErrors = {
  /**
   * Default Response
   */
  503: {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    uptime?: number;
  };
};

export type GetHealthError = GetHealthErrors[keyof GetHealthErrors];

export type GetHealthResponses = {
  /**
   * Default Response
   */
  200: {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    uptime?: number;
  };
};

export type GetHealthResponse = GetHealthResponses[keyof GetHealthResponses];

export type GetHealthDetailedData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/health/detailed";
};

export type GetHealthDetailedResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetHealthLiveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/health/live";
};

export type GetHealthLiveResponses = {
  /**
   * Default Response
   */
  200: {
    status: "alive";
    timestamp: string;
    uptime: number;
  };
};

export type GetHealthLiveResponse = GetHealthLiveResponses[keyof GetHealthLiveResponses];

export type GetHealthReadyData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/health/ready";
};

export type GetHealthReadyErrors = {
  /**
   * Default Response
   */
  503: {
    status: "not ready";
    timestamp: string;
    message: string;
    unhealthyDependencies: Array<string>;
  };
};

export type GetHealthReadyError = GetHealthReadyErrors[keyof GetHealthReadyErrors];

export type GetHealthReadyResponses = {
  /**
   * Default Response
   */
  200: {
    status: "ready";
    timestamp: string;
  };
};

export type GetHealthReadyResponse = GetHealthReadyResponses[keyof GetHealthReadyResponses];

export type GetHealthDependencyByNameData = {
  body?: never;
  path: {
    name: string;
  };
  query?: never;
  url: "/health/dependency/{name}";
};

export type GetHealthDependencyByNameResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostWebhooksStripeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/stripe";
};

export type PostWebhooksStripeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostWebhooksPaddleData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/paddle";
};

export type PostWebhooksPaddleResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthLoginData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/login";
};

export type PostAuthLoginResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthRefreshData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/refresh";
};

export type PostAuthRefreshResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthLogoutData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/logout";
};

export type PostAuthLogoutResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthMeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/me";
};

export type GetAuthMeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthSessionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/sessions";
};

export type GetAuthSessionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthRevokeAllData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/revoke-all";
};

export type PostAuthRevokeAllResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditLogsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/logs";
};

export type GetAdminAuditLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuditLogsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/logs";
};

export type PostAdminAuditLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/stats";
};

export type GetAdminAuditStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditUsersByUserIdLogsData = {
  body?: never;
  path: {
    userId: string;
  };
  query?: never;
  url: "/admin/audit/users/{userId}/logs";
};

export type GetAdminAuditUsersByUserIdLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditResourcesByResourceLogsData = {
  body?: never;
  path: {
    resource: string;
  };
  query?: never;
  url: "/admin/audit/resources/{resource}/logs";
};

export type GetAdminAuditResourcesByResourceLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuditCleanupData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/cleanup";
};

export type PostAdminAuditCleanupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditMyLogsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/my-logs";
};

export type GetAdminAuditMyLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuditExportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/audit/export";
};

export type GetAdminAuditExportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetActivityFeedData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/activity-feed";
};

export type GetActivityFeedResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthMfaStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/mfa/status";
};

export type GetAuthMfaStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthMfaSetupData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/mfa/setup";
};

export type PostAuthMfaSetupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthMfaVerifySetupData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/mfa/verify-setup";
};

export type PostAuthMfaVerifySetupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthMfaDisableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/mfa/disable";
};

export type PostAuthMfaDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthMfaRegenerateBackupCodesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/mfa/regenerate-backup-codes";
};

export type PostAuthMfaRegenerateBackupCodesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminUsersByUserIdMfaStatusData = {
  body?: never;
  path: {
    userId: string;
  };
  query?: never;
  url: "/admin/users/{userId}/mfa/status";
};

export type GetAdminUsersByUserIdMfaStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminUsersByUserIdMfaForceDisableData = {
  body?: never;
  path: {
    userId: string;
  };
  query?: never;
  url: "/admin/users/{userId}/mfa/force-disable";
};

export type PostAdminUsersByUserIdMfaForceDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminCustomersByUserIdMfaForceDisableData = {
  body?: never;
  path: {
    userId: string;
  };
  query?: never;
  url: "/admin/customers/{userId}/mfa/force-disable";
};

export type PostAdminCustomersByUserIdMfaForceDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthPermissionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/permissions";
};

export type GetAuthPermissionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthPermissionsCheckData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/permissions/check";
};

export type PostAuthPermissionsCheckResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminRbacRolesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/rbac/roles";
};

export type GetAdminRbacRolesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminRbacRolesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/rbac/roles";
};

export type PostAdminRbacRolesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminRbacRolesByRoleData = {
  body?: never;
  path: {
    role: string;
  };
  query?: never;
  url: "/admin/rbac/roles/{role}";
};

export type GetAdminRbacRolesByRoleResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminRbacRolesByRoleUsersData = {
  body?: never;
  path: {
    role: string;
  };
  query?: never;
  url: "/admin/rbac/roles/{role}/users";
};

export type GetAdminRbacRolesByRoleUsersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminRbacHierarchyData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/rbac/hierarchy";
};

export type GetAdminRbacHierarchyResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminRbacStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/rbac/status";
};

export type GetAdminRbacStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminRbacUsersByUserIdRoleData = {
  body?: never;
  path: {
    userId: string;
  };
  query?: never;
  url: "/admin/rbac/users/{userId}/role";
};

export type PutAdminRbacUsersByUserIdRoleResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAdminRbacRolesByRoleIdData = {
  body?: never;
  path: {
    roleId: string;
  };
  query?: never;
  url: "/admin/rbac/roles/{roleId}";
};

export type DeleteAdminRbacRolesByRoleIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminRbacRolesByRoleIdData = {
  body?: never;
  path: {
    roleId: string;
  };
  query?: never;
  url: "/admin/rbac/roles/{roleId}";
};

export type PutAdminRbacRolesByRoleIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminRbacRolesByRoleIdPermissionsData = {
  body?: never;
  path: {
    roleId: string;
  };
  query?: never;
  url: "/admin/rbac/roles/{roleId}/permissions";
};

export type PutAdminRbacRolesByRoleIdPermissionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetApiKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/api-keys";
};

export type GetApiKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostApiKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/api-keys";
};

export type PostApiKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostApiKeysByIdRotateData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/api-keys/{id}/rotate";
};

export type PostApiKeysByIdRotateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteApiKeysByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/api-keys/{id}";
};

export type DeleteApiKeysByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts";
};

export type GetAdminAccountsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts";
};

export type PostAdminAccountsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts/stats";
};

export type GetAdminAccountsStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAdminAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}";
};

export type DeleteAdminAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}";
};

export type GetAdminAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}";
};

export type PutAdminAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminAccountsByAccountIdStatusData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/status";
};

export type PutAdminAccountsByAccountIdStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsByAccountIdBillingData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/billing";
};

export type GetAdminAccountsByAccountIdBillingResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsByAccountIdSuspendData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/suspend";
};

export type PostAdminAccountsByAccountIdSuspendResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsByAccountIdReactivateData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/reactivate";
};

export type PostAdminAccountsByAccountIdReactivateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsByAccountIdResetPasswordData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/reset-password";
};

export type PostAdminAccountsByAccountIdResetPasswordResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsByAccountIdSessionsData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/sessions";
};

export type GetAdminAccountsByAccountIdSessionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsByAccountIdRevokeSessionsData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/revoke-sessions";
};

export type PostAdminAccountsByAccountIdRevokeSessionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchAdminAccountsByAccountIdGrandfatheringData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/accounts/{accountId}/grandfathering";
};

export type PatchAdminAccountsByAccountIdGrandfatheringResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsBulkSuspendData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts/bulk/suspend";
};

export type PostAdminAccountsBulkSuspendResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAccountsBulkReactivateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts/bulk/reactivate";
};

export type PostAdminAccountsBulkReactivateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminPricingTiersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/pricing/tiers";
};

export type GetAdminPricingTiersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminPricingProviderTiersByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/provider-tiers/{id}";
};

export type PutAdminPricingProviderTiersByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminPricingAccountTiersByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/account-tiers/{id}";
};

export type PutAdminPricingAccountTiersByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAdminPricingBundlesByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/bundles/{id}";
};

export type DeleteAdminPricingBundlesByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminPricingBundlesByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/bundles/{id}";
};

export type PutAdminPricingBundlesByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminPricingBundlesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/pricing/bundles";
};

export type PostAdminPricingBundlesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminPricingProviderTiersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/pricing/provider-tiers";
};

export type PostAdminPricingProviderTiersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminPricingAccountTiersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/pricing/account-tiers";
};

export type PostAdminPricingAccountTiersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchAdminPricingProviderTiersByIdStatusData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/provider-tiers/{id}/status";
};

export type PatchAdminPricingProviderTiersByIdStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchAdminPricingAccountTiersByIdStatusData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/pricing/account-tiers/{id}/status";
};

export type PatchAdminPricingAccountTiersByIdStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminUsersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/users";
};

export type GetAdminUsersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminUsersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/users";
};

export type PostAdminUsersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminUsersByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/users/{id}";
};

export type GetAdminUsersByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminUsersByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/users/{id}";
};

export type PutAdminUsersByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminUsersByIdDeactivateData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/users/{id}/deactivate";
};

export type PostAdminUsersByIdDeactivateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminUsersByIdActivateData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/users/{id}/activate";
};

export type PostAdminUsersByIdActivateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminUsersByIdPasswordResetData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/users/{id}/password-reset";
};

export type PostAdminUsersByIdPasswordResetResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthLoginData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/login";
};

export type PostAdminAuthLoginResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthRefreshData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/refresh";
};

export type PostAdminAuthRefreshResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthPasswordResetData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/password/reset";
};

export type PostAdminAuthPasswordResetResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthPasswordResetConfirmData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/password/reset/confirm";
};

export type PostAdminAuthPasswordResetConfirmResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthPasswordValidateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/password/validate";
};

export type PostAdminAuthPasswordValidateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuthMeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/me";
};

export type GetAdminAuthMeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthLogoutData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/logout";
};

export type PostAdminAuthLogoutResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminAuthProfileData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/profile";
};

export type PutAdminAuthProfileResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthPasswordChangeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/password/change";
};

export type PostAdminAuthPasswordChangeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthMfaSetupData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/mfa/setup";
};

export type PostAdminAuthMfaSetupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthMfaVerifyData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/mfa/verify";
};

export type PostAdminAuthMfaVerifyResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthMfaDisableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/mfa/disable";
};

export type PostAdminAuthMfaDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuthMfaStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/mfa/status";
};

export type GetAdminAuthMfaStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAuthSessionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/sessions";
};

export type GetAdminAuthSessionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthSessionsRevokeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/sessions/revoke";
};

export type PostAdminAuthSessionsRevokeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAuthSessionsRevokeAllData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/auth/sessions/revoke-all";
};

export type PostAdminAuthSessionsRevokeAllResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAnalyticsMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/analytics/metrics";
};

export type GetAdminAnalyticsMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/metrics";
};

export type GetAdminComplianceMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceAuditLogsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/audit-logs";
};

export type GetAdminComplianceAuditLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceGdprData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/gdpr";
};

export type GetAdminComplianceGdprResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminAccountsByIdSettingsData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/accounts/{id}/settings";
};

export type PutAdminAccountsByIdSettingsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminPostsScheduledData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/posts/scheduled";
};

export type GetAdminPostsScheduledResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminPostsByIdCancelData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/posts/{id}/cancel";
};

export type PostAdminPostsByIdCancelResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminPostsByIdRescheduleData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/posts/{id}/reschedule";
};

export type PostAdminPostsByIdRescheduleResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminQueueStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/queue/stats";
};

export type GetAdminQueueStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminQueueJobsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/queue/jobs";
};

export type GetAdminQueueJobsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminQueueJobsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/queue/jobs/{id}";
};

export type GetAdminQueueJobsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminQueueJobsByIdRetryData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/queue/jobs/{id}/retry";
};

export type PostAdminQueueJobsByIdRetryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminQueueJobsByIdRemoveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/queue/jobs/{id}/remove";
};

export type PostAdminQueueJobsByIdRemoveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingPlansData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/plans";
};

export type GetAdminBillingPlansResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingPlansByTierData = {
  body?: never;
  path: {
    tier: string;
  };
  query?: never;
  url: "/admin/billing/plans/{tier}";
};

export type GetAdminBillingPlansByTierResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingAccountsByAccountIdSubscriptionData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/subscription";
};

export type GetAdminBillingAccountsByAccountIdSubscriptionResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminBillingAccountsByAccountIdSubscriptionData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/subscription";
};

export type PutAdminBillingAccountsByAccountIdSubscriptionResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingSubscriptionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/subscriptions";
};

export type GetAdminBillingSubscriptionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/stats";
};

export type GetAdminBillingStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAccountsByAccountIdValidateLimitsData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/validate-limits";
};

export type PostAdminBillingAccountsByAccountIdValidateLimitsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAccountsByAccountIdSuspendData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/suspend";
};

export type PostAdminBillingAccountsByAccountIdSuspendResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingBulkUpgradeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/bulk/upgrade";
};

export type PostAdminBillingBulkUpgradeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingHealthData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/health";
};

export type GetAdminBillingHealthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingExportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/export";
};

export type GetAdminBillingExportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAccountsByAccountIdTrialStartData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/trial/start";
};

export type PostAdminBillingAccountsByAccountIdTrialStartResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAccountsByAccountIdTrialEndData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/trial/end";
};

export type PostAdminBillingAccountsByAccountIdTrialEndResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAccountsByAccountIdTrialConvertData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/billing/accounts/{accountId}/trial/convert";
};

export type PostAdminBillingAccountsByAccountIdTrialConvertResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingTrialsExpiringData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/trials/expiring";
};

export type GetAdminBillingTrialsExpiringResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingAutoRenewalsProcessData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/auto-renewals/process";
};

export type PostAdminBillingAutoRenewalsProcessResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingTrialsStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/trials/stats";
};

export type GetAdminBillingTrialsStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBillingGatewayStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/gateway/status";
};

export type GetBillingGatewayStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteBillingGatewaySwitchData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/gateway/switch";
};

export type DeleteBillingGatewaySwitchResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostBillingGatewaySwitchData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/gateway/switch";
};

export type PostBillingGatewaySwitchResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBillingPlansData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/plans";
};

export type GetBillingPlansResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostBillingCheckoutData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/checkout";
};

export type PostBillingCheckoutResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBillingPortalData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/portal";
};

export type GetBillingPortalResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBillingInvoicesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/billing/invoices";
};

export type GetBillingInvoicesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingGatewaySwitchesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/gateway-switches";
};

export type GetAdminBillingGatewaySwitchesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingGatewaySwitchesByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/billing/gateway-switches/{id}";
};

export type GetAdminBillingGatewaySwitchesByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingGatewaySwitchesByIdExtendData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/billing/gateway-switches/{id}/extend";
};

export type PostAdminBillingGatewaySwitchesByIdExtendResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingGatewaySwitchesByIdForceCompleteData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/billing/gateway-switches/{id}/force-complete";
};

export type PostAdminBillingGatewaySwitchesByIdForceCompleteResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminBillingGatewaySwitchesByIdForceSuspendData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/billing/gateway-switches/{id}/force-suspend";
};

export type PostAdminBillingGatewaySwitchesByIdForceSuspendResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminBillingInvoicesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/billing/invoices";
};

export type GetAdminBillingInvoicesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceSettingsGdprData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/settings/gdpr";
};

export type GetAdminComplianceSettingsGdprResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminComplianceSettingsGdprData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/settings/gdpr";
};

export type PutAdminComplianceSettingsGdprResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceSettingsSecurityData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/settings/security";
};

export type GetAdminComplianceSettingsSecurityResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminComplianceSettingsSecurityData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/settings/security";
};

export type PutAdminComplianceSettingsSecurityResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceScoreData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/score";
};

export type GetAdminComplianceScoreResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceDsarData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/dsar";
};

export type GetAdminComplianceDsarResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceDsarByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/compliance/dsar/{id}";
};

export type GetAdminComplianceDsarByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminComplianceDsarByIdAcknowledgeData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/compliance/dsar/{id}/acknowledge";
};

export type PostAdminComplianceDsarByIdAcknowledgeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminComplianceDsarByIdCompleteData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/compliance/dsar/{id}/complete";
};

export type PostAdminComplianceDsarByIdCompleteResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminComplianceDsarByIdRejectData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/compliance/dsar/{id}/reject";
};

export type PostAdminComplianceDsarByIdRejectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminComplianceBreachesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/breaches";
};

export type GetAdminComplianceBreachesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminComplianceBreachesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/compliance/breaches";
};

export type PostAdminComplianceBreachesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminComplianceBreachesByIdNotifyData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/compliance/breaches/{id}/notify";
};

export type PostAdminComplianceBreachesByIdNotifyResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostComplianceDsarData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/compliance/dsar";
};

export type PostComplianceDsarResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminSettingsStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/settings/status";
};

export type GetAdminSettingsStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminSettingsByGroupData = {
  body?: never;
  path: {
    group: string;
  };
  query?: never;
  url: "/admin/settings/{group}";
};

export type GetAdminSettingsByGroupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminSettingsByGroupData = {
  body?: never;
  path: {
    group: string;
  };
  query?: never;
  url: "/admin/settings/{group}";
};

export type PutAdminSettingsByGroupResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminSettingsByGroupTestData = {
  body?: never;
  path: {
    group: string;
  };
  query?: never;
  url: "/admin/settings/{group}/test";
};

export type PostAdminSettingsByGroupTestResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAdminSettingsByGroupByKeyData = {
  body?: never;
  path: {
    group: string;
    key: string;
  };
  query?: never;
  url: "/admin/settings/{group}/{key}";
};

export type DeleteAdminSettingsByGroupByKeyResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminSettingsEncryptionRotateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/settings/encryption/rotate";
};

export type PostAdminSettingsEncryptionRotateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSettingsAiData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/settings/ai";
};

export type GetSettingsAiResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutSettingsAiByokData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/settings/ai/byok";
};

export type PutSettingsAiByokResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteSettingsAiByokByProviderData = {
  body?: never;
  path: {
    provider: string;
  };
  query?: never;
  url: "/settings/ai/byok/{provider}";
};

export type DeleteSettingsAiByokByProviderResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSettingsAiByokTestData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/settings/ai/byok/test";
};

export type PostSettingsAiByokTestResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSettingsPublicData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/settings/public";
};

export type GetSettingsPublicResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminOutboxDeadLetterData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/outbox/dead-letter";
};

export type GetAdminOutboxDeadLetterResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminOutboxDeadLetterByIdRetryData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/outbox/dead-letter/{id}/retry";
};

export type PostAdminOutboxDeadLetterByIdRetryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminOutboxDeadLetterByIdResolveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/outbox/dead-letter/{id}/resolve";
};

export type PostAdminOutboxDeadLetterByIdResolveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsStreamData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/analytics/stream";
};

export type GetAnalyticsStreamResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsProjectByProjectIdData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/analytics/project/{projectId}";
};

export type GetAnalyticsProjectByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetThreadsByThreadIdPerformanceData = {
  body?: never;
  path: {
    threadId: string;
  };
  query?: never;
  url: "/threads/{threadId}/performance";
};

export type GetThreadsByThreadIdPerformanceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetThreadsCompareData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/threads/compare";
};

export type GetThreadsCompareResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetEngagementTrendsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/engagement/trends";
};

export type GetEngagementTrendsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsBestTimesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/posts/best-times";
};

export type GetPostsBestTimesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetEngagementGeographicData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/engagement/geographic";
};

export type GetEngagementGeographicResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetContentMediaPerformanceData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/media-performance";
};

export type GetContentMediaPerformanceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsDashboardData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/analytics/dashboard";
};

export type GetAnalyticsDashboardResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetExportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/export";
};

export type GetExportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsRoiData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/analytics/roi";
};

export type GetAnalyticsRoiResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsCrossPlatformData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/analytics/cross-platform";
};

export type GetAnalyticsCrossPlatformResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiGenerateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/generate";
};

export type PostAiGenerateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiAnalyzeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/analyze";
};

export type PostAiAnalyzeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiOptimizeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/optimize";
};

export type PostAiOptimizeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiPredictData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/predict";
};

export type PostAiPredictResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiVariationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/variations";
};

export type PostAiVariationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiSmartAnalysisData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/smart-analysis";
};

export type PostAiSmartAnalysisResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiPredictTimingData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/predict-timing";
};

export type PostAiPredictTimingResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiPredictAudienceData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/predict-audience";
};

export type PostAiPredictAudienceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAiCacheData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/cache";
};

export type DeleteAiCacheResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAccountsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/accounts";
};

export type GetAccountsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAccountsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/accounts";
};

export type PostAccountsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}";
};

export type DeleteAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}";
};

export type GetAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAccountsByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}";
};

export type PutAccountsByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAccountsByAccountIdHardData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}/hard";
};

export type DeleteAccountsByAccountIdHardResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAccountsByAccountIdProjectsData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}/projects";
};

export type GetAccountsByAccountIdProjectsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAccountsByAccountIdProjectsData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}/projects";
};

export type PostAccountsByAccountIdProjectsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteProjectsByProjectIdData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}";
};

export type DeleteProjectsByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}";
};

export type GetProjectsByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdPublishLogsData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/publish-logs";
};

export type GetProjectsByProjectIdPublishLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteProjectsByProjectIdHardData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/hard";
};

export type DeleteProjectsByProjectIdHardResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/posts";
};

export type GetPostsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeletePostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/posts/{id}";
};

export type DeletePostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/posts/{id}";
};

export type GetPostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchPostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/posts/{id}";
};

export type PatchPostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchPostsBatchArchiveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/posts/batch/archive";
};

export type PatchPostsBatchArchiveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeletePostsBatchData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/posts/batch";
};

export type DeletePostsBatchResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostPostsBatchDuplicateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/posts/batch/duplicate";
};

export type PostPostsBatchDuplicateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostChannelsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/channels";
};

export type PostChannelsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostChannelsBlueskyConnectData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/channels/bluesky/connect";
};

export type PostChannelsBlueskyConnectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteChannelsByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/channels/{channelId}";
};

export type DeleteChannelsByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetChannelsByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/channels/{channelId}";
};

export type GetChannelsByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutChannelsByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/channels/{channelId}";
};

export type PutChannelsByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdChannelsData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/channels";
};

export type GetProjectsByProjectIdChannelsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchChannelsByChannelIdSetPrimaryData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/channels/{channelId}/set-primary";
};

export type PatchChannelsByChannelIdSetPrimaryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteChannelsByChannelIdHardData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/channels/{channelId}/hard";
};

export type DeleteChannelsByChannelIdHardResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteProjectsByProjectIdCrisisData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/crisis";
};

export type DeleteProjectsByProjectIdCrisisResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdCrisisData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/crisis";
};

export type GetProjectsByProjectIdCrisisResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdCrisisData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/crisis";
};

export type PostProjectsByProjectIdCrisisResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostLinksData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/links";
};

export type PostLinksResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteLinksByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/links/{id}";
};

export type DeleteLinksByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetLinksByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/links/{id}";
};

export type GetLinksByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetLinksByIdStatsData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/links/{id}/stats";
};

export type GetLinksByIdStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetRByShortCodeData = {
  body?: never;
  path: {
    shortCode: string;
  };
  query?: never;
  url: "/r/{shortCode}";
};

export type GetRByShortCodeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTeamData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/team";
};

export type GetTeamResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTeamMentionSearchData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/team/mention-search";
};

export type GetTeamMentionSearchResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostTeamInviteData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/team/invite";
};

export type PostTeamInviteResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchTeamByIdRoleData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/team/{id}/role";
};

export type PatchTeamByIdRoleResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteTeamByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/team/{id}";
};

export type DeleteTeamByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetNotificationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications";
};

export type GetNotificationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostNotificationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications";
};

export type PostNotificationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetNotificationsUnreadCountData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications/unread-count";
};

export type GetNotificationsUnreadCountResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchNotificationsByIdReadData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/notifications/{id}/read";
};

export type PatchNotificationsByIdReadResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostNotificationsMarkAllReadData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications/mark-all-read";
};

export type PostNotificationsMarkAllReadResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetNotificationsPreferencesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications/preferences";
};

export type GetNotificationsPreferencesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutNotificationsPreferencesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications/preferences";
};

export type PutNotificationsPreferencesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetNotificationsStreamData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/notifications/stream";
};

export type GetNotificationsStreamResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostPostsByPostIdSubmitForReviewData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/submit-for-review";
};

export type PostPostsByPostIdSubmitForReviewResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostApprovalsByIdApproveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/approvals/{id}/approve";
};

export type PostApprovalsByIdApproveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostApprovalsByIdRejectData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/approvals/{id}/reject";
};

export type PostApprovalsByIdRejectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsByPostIdApprovalsData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/approvals";
};

export type GetPostsByPostIdApprovalsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetApprovalsPendingData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/approvals/pending";
};

export type GetApprovalsPendingResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetOnboardingData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/onboarding";
};

export type GetOnboardingResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostOnboardingStepByStepKeyCompleteData = {
  body?: never;
  path: {
    stepKey: string;
  };
  query?: never;
  url: "/onboarding/step/{stepKey}/complete";
};

export type PostOnboardingStepByStepKeyCompleteResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostOnboardingDismissData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/onboarding/dismiss";
};

export type PostOnboardingDismissResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnnouncementsActiveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/announcements/active";
};

export type GetAnnouncementsActiveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAnnouncementsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/announcements";
};

export type GetAdminAnnouncementsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminAnnouncementsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/announcements";
};

export type PostAdminAnnouncementsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAdminAnnouncementsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/announcements/{id}";
};

export type DeleteAdminAnnouncementsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAdminAnnouncementsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/announcements/{id}";
};

export type PutAdminAnnouncementsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetApprovalWorkflowsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/approval-workflows";
};

export type GetApprovalWorkflowsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostApprovalWorkflowsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/approval-workflows";
};

export type PostApprovalWorkflowsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteApprovalWorkflowsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/approval-workflows/{id}";
};

export type DeleteApprovalWorkflowsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetApprovalWorkflowsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/approval-workflows/{id}";
};

export type GetApprovalWorkflowsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchApprovalWorkflowsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/approval-workflows/{id}";
};

export type PatchApprovalWorkflowsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsByPostIdCommentsData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/comments";
};

export type GetPostsByPostIdCommentsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostPostsByPostIdCommentsData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/comments";
};

export type PostPostsByPostIdCommentsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteCommentsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/comments/{id}";
};

export type DeleteCommentsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchCommentsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/comments/{id}";
};

export type PatchCommentsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/inbox";
};

export type GetInboxResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxUnreadCountData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/inbox/unread-count";
};

export type GetInboxUnreadCountResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxMentionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/inbox/mentions";
};

export type GetInboxMentionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxConversationsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}";
};

export type GetInboxConversationsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxConversationsByIdMessagesData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}/messages";
};

export type GetInboxConversationsByIdMessagesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchInboxMessagesByIdReadData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/messages/{id}/read";
};

export type PatchInboxMessagesByIdReadResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchInboxMessagesByIdArchiveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/messages/{id}/archive";
};

export type PatchInboxMessagesByIdArchiveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchInboxMessagesByIdAssignData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/messages/{id}/assign";
};

export type PatchInboxMessagesByIdAssignResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostInboxMessagesByIdReplyData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/messages/{id}/reply";
};

export type PostInboxMessagesByIdReplyResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchInboxConversationsByIdResolveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}/resolve";
};

export type PatchInboxConversationsByIdResolveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchInboxConversationsByIdReopenData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}/reopen";
};

export type PatchInboxConversationsByIdReopenResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostInboxSyncByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/inbox/sync/{channelId}";
};

export type PostInboxSyncByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetListeningShareOfVoiceData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/listening/share-of-voice";
};

export type GetListeningShareOfVoiceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetListeningMentionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/listening/mentions";
};

export type GetListeningMentionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostBulkSchedulingParseData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/bulk-scheduling/parse";
};

export type PostBulkSchedulingParseResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostBulkSchedulingConfirmData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/bulk-scheduling/confirm";
};

export type PostBulkSchedulingConfirmResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBulkSchedulingBatchesByBatchIdData = {
  body?: never;
  path: {
    batchId: string;
  };
  query?: never;
  url: "/bulk-scheduling/batches/{batchId}";
};

export type GetBulkSchedulingBatchesByBatchIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostBulkSchedulingImportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/bulk-scheduling/imports";
};

export type PostBulkSchedulingImportsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetInboxConversationsByIdNotesData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}/notes";
};

export type GetInboxConversationsByIdNotesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostInboxConversationsByIdNotesData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/inbox/conversations/{id}/notes";
};

export type PostInboxConversationsByIdNotesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteInboxConversationsByConversationIdNotesByNoteIdData = {
  body?: never;
  path: {
    conversationId: string;
    noteId: string;
  };
  query?: never;
  url: "/inbox/conversations/{conversationId}/notes/{noteId}";
};

export type DeleteInboxConversationsByConversationIdNotesByNoteIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCampaignsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/campaigns";
};

export type GetCampaignsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCampaignsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/campaigns";
};

export type PostCampaignsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCampaignsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/campaigns/{id}";
};

export type GetCampaignsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchCampaignsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/campaigns/{id}";
};

export type PatchCampaignsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCampaignsByIdArchiveData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/campaigns/{id}/archive";
};

export type PostCampaignsByIdArchiveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteCampaignsByIdPostsByPostIdData = {
  body?: never;
  path: {
    id: string;
    postId: string;
  };
  query?: never;
  url: "/campaigns/{id}/posts/{postId}";
};

export type DeleteCampaignsByIdPostsByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCampaignsByIdPostsByPostIdData = {
  body?: never;
  path: {
    id: string;
    postId: string;
  };
  query?: never;
  url: "/campaigns/{id}/posts/{postId}";
};

export type PostCampaignsByIdPostsByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCampaignsByIdAnalyticsData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/campaigns/{id}/analytics";
};

export type GetCampaignsByIdAnalyticsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostLinksByIdUtmData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/links/{id}/utm";
};

export type PostLinksByIdUtmResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetLinksByIdUtmUrlData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/links/{id}/utm-url";
};

export type GetLinksByIdUtmUrlResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetReportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/reports";
};

export type GetReportsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostReportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/reports";
};

export type PostReportsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/reports/{id}";
};

export type DeleteReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/reports/{id}";
};

export type GetReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/reports/{id}";
};

export type PatchReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostReportsByIdGenerateData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/reports/{id}/generate";
};

export type PostReportsByIdGenerateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeletePostsByPostIdFirstCommentData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/first-comment";
};

export type DeletePostsByPostIdFirstCommentResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPostsByPostIdFirstCommentData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/first-comment";
};

export type GetPostsByPostIdFirstCommentResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutPostsByPostIdFirstCommentData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/posts/{postId}/first-comment";
};

export type PutPostsByPostIdFirstCommentResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetExternalNotificationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/external-notifications";
};

export type GetExternalNotificationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostExternalNotificationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/external-notifications";
};

export type PostExternalNotificationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteExternalNotificationsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/external-notifications/{id}";
};

export type DeleteExternalNotificationsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostExternalNotificationsByIdTestData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/external-notifications/{id}/test";
};

export type PostExternalNotificationsByIdTestResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiGenerateImageData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/generate-image";
};

export type PostAiGenerateImageResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAiGeneratedImagesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/generated-images";
};

export type GetAiGeneratedImagesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetRecurringPostsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/recurring-posts";
};

export type GetRecurringPostsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostRecurringPostsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/recurring-posts";
};

export type PostRecurringPostsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteRecurringPostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/recurring-posts/{id}";
};

export type DeleteRecurringPostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetRecurringPostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/recurring-posts/{id}";
};

export type GetRecurringPostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchRecurringPostsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/recurring-posts/{id}";
};

export type PatchRecurringPostsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetRepurposeProposalsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/repurpose/proposals";
};

export type GetRepurposeProposalsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostRepurposeDetectData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/repurpose/detect";
};

export type PostRepurposeDetectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAiTemplatesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai-templates";
};

export type GetAiTemplatesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiTemplatesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai-templates";
};

export type PostAiTemplatesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAiTemplatesByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/ai-templates/{id}";
};

export type DeleteAiTemplatesByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchAiTemplatesByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/ai-templates/{id}";
};

export type PatchAiTemplatesByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAccountsByAccountIdUsageData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/accounts/{accountId}/usage";
};

export type GetAccountsByAccountIdUsageResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAiBrandVoiceData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/brand-voice";
};

export type GetAiBrandVoiceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiBrandVoiceData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/brand-voice";
};

export type PostAiBrandVoiceResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAiBrandVoiceByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/ai/brand-voice/{accountId}";
};

export type DeleteAiBrandVoiceByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutAiBrandVoiceByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/ai/brand-voice/{accountId}";
};

export type PutAiBrandVoiceByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteBrandKitByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/brand-kit/{accountId}";
};

export type DeleteBrandKitByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetBrandKitByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/brand-kit/{accountId}";
};

export type GetBrandKitByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutBrandKitByAccountIdData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/brand-kit/{accountId}";
};

export type PutBrandKitByAccountIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAssetsTagsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets/tags";
};

export type GetAssetsTagsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAssetsTagsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets/tags";
};

export type PostAssetsTagsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAssetsTagsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/assets/tags/{id}";
};

export type DeleteAssetsTagsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAssetsFoldersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets/folders";
};

export type GetAssetsFoldersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAssetsFoldersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets/folders";
};

export type PostAssetsFoldersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAssetsImportGoogleDriveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets/import/google-drive";
};

export type PostAssetsImportGoogleDriveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAssetsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets";
};

export type GetAssetsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAssetsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/assets";
};

export type PostAssetsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAssetsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/assets/{id}";
};

export type DeleteAssetsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAssetsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/assets/{id}";
};

export type GetAssetsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchAssetsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/assets/{id}";
};

export type PatchAssetsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAssetsByIdTagsData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/assets/{id}/tags";
};

export type PostAssetsByIdTagsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetZapierKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/keys";
};

export type GetZapierKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostZapierKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/keys";
};

export type PostZapierKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteZapierKeysByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/zapier/keys/{id}";
};

export type DeleteZapierKeysByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostZapierSubscribeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/subscribe";
};

export type PostZapierSubscribeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteZapierSubscribeByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/zapier/subscribe/{id}";
};

export type DeleteZapierSubscribeByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostZapierActionsCreateDraftData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/actions/create-draft";
};

export type PostZapierActionsCreateDraftResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostZapierActionsSchedulePostData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/actions/schedule-post";
};

export type PostZapierActionsSchedulePostResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetZapierTriggersPostsPublishedData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/zapier/triggers/posts-published";
};

export type GetZapierTriggersPostsPublishedResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetMakeKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/keys";
};

export type GetMakeKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostMakeKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/keys";
};

export type PostMakeKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteMakeKeysByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/make/keys/{id}";
};

export type DeleteMakeKeysByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostMakeSubscribeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/subscribe";
};

export type PostMakeSubscribeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteMakeSubscribeByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/make/subscribe/{id}";
};

export type DeleteMakeSubscribeByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostMakeActionsCreateDraftData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/actions/create-draft";
};

export type PostMakeActionsCreateDraftResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostMakeActionsSchedulePostData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/actions/schedule-post";
};

export type PostMakeActionsSchedulePostResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetMakeTriggersPostsPublishedData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/make/triggers/posts-published";
};

export type GetMakeTriggersPostsPublishedResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTasksData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/tasks";
};

export type GetTasksResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostTasksData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/tasks";
};

export type PostTasksResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteTasksByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/tasks/{id}";
};

export type DeleteTasksByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTasksByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/tasks/{id}";
};

export type GetTasksByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchTasksByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/tasks/{id}";
};

export type PatchTasksByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostTasksByIdCompleteData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/tasks/{id}/complete";
};

export type PostTasksByIdCompleteResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostTasksByIdCancelData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/tasks/{id}/cancel";
};

export type PostTasksByIdCancelResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSamlConfigData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/saml/config";
};

export type GetSamlConfigResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutSamlConfigData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/saml/config";
};

export type PutSamlConfigResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSamlEnableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/saml/enable";
};

export type PostSamlEnableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSamlDisableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/saml/disable";
};

export type PostSamlDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthSamlByAccountIdMetadataData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/auth/saml/{accountId}/metadata";
};

export type GetAuthSamlByAccountIdMetadataResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthSamlByAccountIdLoginData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/auth/saml/{accountId}/login";
};

export type GetAuthSamlByAccountIdLoginResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthSamlByAccountIdCallbackData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/auth/saml/{accountId}/callback";
};

export type PostAuthSamlByAccountIdCallbackResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetOidcConfigData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/oidc/config";
};

export type GetOidcConfigResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutOidcConfigData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/oidc/config";
};

export type PutOidcConfigResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostOidcEnableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/oidc/enable";
};

export type PostOidcEnableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostOidcDisableData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/oidc/disable";
};

export type PostOidcDisableResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthOidcByAccountIdLoginData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/auth/oidc/{accountId}/login";
};

export type GetAuthOidcByAccountIdLoginResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthOidcByAccountIdCallbackData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/auth/oidc/{accountId}/callback";
};

export type GetAuthOidcByAccountIdCallbackResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetReportsSchemaData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/reports/schema";
};

export type GetReportsSchemaResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCustomReportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/custom-reports";
};

export type GetCustomReportsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCustomReportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/custom-reports";
};

export type PostCustomReportsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteCustomReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/custom-reports/{id}";
};

export type DeleteCustomReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCustomReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/custom-reports/{id}";
};

export type GetCustomReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PatchCustomReportsByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/custom-reports/{id}";
};

export type PatchCustomReportsByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCustomReportsByIdRunData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/custom-reports/{id}/run";
};

export type PostCustomReportsByIdRunResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCustomReportsByIdSchedulesData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/custom-reports/{id}/schedules";
};

export type PostCustomReportsByIdSchedulesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSchedulingSlotsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/scheduling/slots";
};

export type GetSchedulingSlotsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSchedulingSlotsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/scheduling/slots";
};

export type PostSchedulingSlotsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAnalyticsOptimalTimesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/analytics/optimal-times";
};

export type GetAnalyticsOptimalTimesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSchedulingRulesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/scheduling/rules";
};

export type GetSchedulingRulesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSchedulingSlotsBulkData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/scheduling/slots/bulk";
};

export type PostSchedulingSlotsBulkResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/providers";
};

export type GetProvidersResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersActiveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/providers/active";
};

export type GetProvidersActiveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersByCapabilityByCapabilityData = {
  body?: never;
  path: {
    capability: string;
  };
  query?: never;
  url: "/providers/by-capability/{capability}";
};

export type GetProvidersByCapabilityByCapabilityResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/providers/{id}";
};

export type GetProvidersByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersByIdHealthData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/providers/{id}/health";
};

export type GetProvidersByIdHealthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersHealthAllData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/providers/health/all";
};

export type GetProvidersHealthAllResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProvidersConnectionsByProjectIdData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/providers/connections/{projectId}";
};

export type GetProvidersConnectionsByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates";
};

export type GetProjectsByProjectIdTemplatesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates";
};

export type PostProjectsByProjectIdTemplatesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteProjectsByProjectIdTemplatesByTemplateIdData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}";
};

export type DeleteProjectsByProjectIdTemplatesByTemplateIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesByTemplateIdData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}";
};

export type GetProjectsByProjectIdTemplatesByTemplateIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PutProjectsByProjectIdTemplatesByTemplateIdData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}";
};

export type PutProjectsByProjectIdTemplatesByTemplateIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdDuplicateData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/duplicate";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdDuplicateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdCompileData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/compile";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdCompileResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdValidateData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/validate";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdValidateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesByTemplateIdVersionsData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/versions";
};

export type GetProjectsByProjectIdTemplatesByTemplateIdVersionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdVersionsData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/versions";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdVersionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdVersionsByVersionIdRestoreData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
    versionId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/versions/{versionId}/restore";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdVersionsByVersionIdRestoreResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesAnalyticsData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/analytics";
};

export type GetProjectsByProjectIdTemplatesAnalyticsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesByTemplateIdUsageData = {
  body?: never;
  path: {
    projectId: string;
    templateId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/{templateId}/usage";
};

export type PostProjectsByProjectIdTemplatesByTemplateIdUsageResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesAbTestsData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/ab-tests";
};

export type GetProjectsByProjectIdTemplatesAbTestsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesAbTestsData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/ab-tests";
};

export type PostProjectsByProjectIdTemplatesAbTestsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesAbTestsByTestIdStartData = {
  body?: never;
  path: {
    projectId: string;
    testId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/ab-tests/{testId}/start";
};

export type PostProjectsByProjectIdTemplatesAbTestsByTestIdStartResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostProjectsByProjectIdTemplatesAbTestsByTestIdStopData = {
  body?: never;
  path: {
    projectId: string;
    testId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/ab-tests/{testId}/stop";
};

export type PostProjectsByProjectIdTemplatesAbTestsByTestIdStopResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetProjectsByProjectIdTemplatesAbTestsByTestIdResultsData = {
  body?: never;
  path: {
    projectId: string;
    testId: string;
  };
  query?: never;
  url: "/projects/{projectId}/templates/ab-tests/{testId}/results";
};

export type GetProjectsByProjectIdTemplatesAbTestsByTestIdResultsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPlatformsByPlatformLimitsData = {
  body?: never;
  path: {
    platform: string;
  };
  query?: never;
  url: "/platforms/{platform}/limits";
};

export type GetPlatformsByPlatformLimitsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetPlatformsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/platforms";
};

export type GetPlatformsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentSyncByPostIdData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/content/sync/{postId}";
};

export type PostContentSyncByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetContentSyncMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/sync/metrics";
};

export type GetContentSyncMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetContentSyncMetricsByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/content/sync/metrics/{channelId}";
};

export type GetContentSyncMetricsByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentSyncByTransactionIdRollbackData = {
  body?: never;
  path: {
    transactionId: string;
  };
  query?: never;
  url: "/content/sync/{transactionId}/rollback";
};

export type PostContentSyncByTransactionIdRollbackResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentChannelsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/channels";
};

export type PostContentChannelsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentChannelsRealtimeStartData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/channels/realtime/start";
};

export type PostContentChannelsRealtimeStartResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentChannelsRealtimeStopByPostIdData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/content/channels/realtime/stop/{postId}";
};

export type PostContentChannelsRealtimeStopByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetContentVersionsByPostIdData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/content/versions/{postId}";
};

export type GetContentVersionsByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentVersionsByPostIdData = {
  body?: never;
  path: {
    postId: string;
  };
  query?: never;
  url: "/content/versions/{postId}";
};

export type PostContentVersionsByPostIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentVersionsByPostIdRestoreByVersionIdData = {
  body?: never;
  path: {
    postId: string;
    versionId: string;
  };
  query?: never;
  url: "/content/versions/{postId}/restore/{versionId}";
};

export type PostContentVersionsByPostIdRestoreByVersionIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentVersionsCompareData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/versions/compare";
};

export type PostContentVersionsCompareResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentConflictsResolveData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/conflicts/resolve";
};

export type PostContentConflictsResolveResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetContentConflictsHistoryByChannelIdData = {
  body?: never;
  path: {
    channelId: string;
  };
  query?: never;
  url: "/content/conflicts/history/{channelId}";
};

export type GetContentConflictsHistoryByChannelIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentTransformData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/transform";
};

export type PostContentTransformResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentTransformMultiData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/transform/multi";
};

export type PostContentTransformMultiResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentTransformRecommendationsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/transform/recommendations";
};

export type PostContentTransformRecommendationsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentRenderByProviderData = {
  body?: never;
  path: {
    provider: string;
  };
  query?: never;
  url: "/content/render/{provider}";
};

export type PostContentRenderByProviderResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostContentDiffData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/content/diff";
};

export type PostContentDiffResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminDashboardStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/dashboard/stats";
};

export type GetAdminDashboardStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsSummaryData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts/summary";
};

export type GetAdminAccountsSummaryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAccountsExportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/accounts/export";
};

export type GetAdminAccountsExportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminSubscriptionsSummaryData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/subscriptions/summary";
};

export type GetAdminSubscriptionsSummaryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminAnalyticsOverviewData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/analytics/overview";
};

export type GetAdminAnalyticsOverviewResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAdminSecuritySecretsRotationStatusData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/admin/security/secrets/rotation-status";
};

export type GetAdminSecuritySecretsRotationStatusResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminChannelsByIdForceReauthData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/channels/{id}/force-reauth";
};

export type PostAdminChannelsByIdForceReauthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminWebhooksByIdRotateSecretData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/webhooks/{id}/rotate-secret";
};

export type PostAdminWebhooksByIdRotateSecretResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminOidcConfigurationsByAccountIdReplaceClientSecretData = {
  body?: never;
  path: {
    accountId: string;
  };
  query?: never;
  url: "/admin/oidc/configurations/{accountId}/replace-client-secret";
};

export type PostAdminOidcConfigurationsByAccountIdReplaceClientSecretResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminApiKeysByIdRotateData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/admin/api-keys/{id}/rotate";
};

export type PostAdminApiKeysByIdRotateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAdminProvidersByProviderForceMassReauthData = {
  body?: never;
  path: {
    provider: string;
  };
  query?: never;
  url: "/admin/providers/{provider}/force-mass-reauth";
};

export type PostAdminProvidersByProviderForceMassReauthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsAnalysisData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/analysis";
};

export type GetTrendsAnalysisResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsViralData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/viral";
};

export type GetTrendsViralResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsOpportunitiesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/opportunities";
};

export type GetTrendsOpportunitiesResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsPredictionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/predictions";
};

export type GetTrendsPredictionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsReportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/report";
};

export type GetTrendsReportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetTrendsRadarData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/trends/radar";
};

export type GetTrendsRadarResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiGenerateLocalizedData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/generate-localized";
};

export type PostAiGenerateLocalizedResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAiGlossaryData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/glossary";
};

export type GetAiGlossaryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiGlossaryData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/glossary";
};

export type PostAiGlossaryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAiGlossaryByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/ai/glossary/{id}";
};

export type DeleteAiGlossaryByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAiStyleGuideData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/style-guide";
};

export type GetAiStyleGuideResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAiStyleGuideData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/ai/style-guide";
};

export type PostAiStyleGuideResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAiStyleGuideByIdData = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: "/ai/style-guide/{id}";
};

export type DeleteAiStyleGuideByIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/metrics";
};

export type GetWebhooksDashboardMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardEventsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/events";
};

export type GetWebhooksDashboardEventsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardEventsByEventIdData = {
  body?: never;
  path: {
    eventId: string;
  };
  query?: never;
  url: "/webhooks/dashboard/events/{eventId}";
};

export type GetWebhooksDashboardEventsByEventIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardSubscriptionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/subscriptions";
};

export type GetWebhooksDashboardSubscriptionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardDeadLetterData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/dead-letter";
};

export type GetWebhooksDashboardDeadLetterResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardDeadLetterMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/dead-letter/metrics";
};

export type GetWebhooksDashboardDeadLetterMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostWebhooksDashboardDeadLetterRetryAllData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/dead-letter/retry-all";
};

export type PostWebhooksDashboardDeadLetterRetryAllResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostWebhooksDashboardDeadLetterByEventIdRetryData = {
  body?: never;
  path: {
    eventId: string;
  };
  query?: never;
  url: "/webhooks/dashboard/dead-letter/{eventId}/retry";
};

export type PostWebhooksDashboardDeadLetterByEventIdRetryResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardStreamData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/stream";
};

export type GetWebhooksDashboardStreamResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetWebhooksDashboardExportData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/webhooks/dashboard/export";
};

export type GetWebhooksDashboardExportResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCacheStatsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/stats";
};

export type GetCacheStatsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCacheHealthData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/health";
};

export type GetCacheHealthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCacheFlushData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/flush";
};

export type PostCacheFlushResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCacheInvalidateData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/invalidate";
};

export type PostCacheInvalidateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCacheHotKeysData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/hot-keys";
};

export type GetCacheHotKeysResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCacheWarmData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/cache/warm";
};

export type PostCacheWarmResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthByProviderData = {
  body?: never;
  path: {
    provider: string;
  };
  query?: never;
  url: "/auth/{provider}";
};

export type GetAuthByProviderResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthCallbackByProviderData = {
  body?: never;
  path: {
    provider: string;
  };
  query?: never;
  url: "/auth/callback/{provider}";
};

export type GetAuthCallbackByProviderResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthConnectionsByProjectIdData = {
  body?: never;
  path: {
    projectId: string;
  };
  query?: never;
  url: "/auth/connections/{projectId}";
};

export type GetAuthConnectionsByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteAuthConnectionsByConnectionIdData = {
  body?: never;
  path: {
    connectionId: string;
  };
  query?: never;
  url: "/auth/connections/{connectionId}";
};

export type DeleteAuthConnectionsByConnectionIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCrmConnectionsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/crm/connections";
};

export type GetCrmConnectionsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCrmByPlatformConnectData = {
  body?: never;
  path: {
    platform: string;
  };
  query?: never;
  url: "/crm/{platform}/connect";
};

export type PostCrmByPlatformConnectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostCrmByPlatformSyncData = {
  body?: never;
  path: {
    platform: string;
  };
  query?: never;
  url: "/crm/{platform}/sync";
};

export type PostCrmByPlatformSyncResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type DeleteCrmByPlatformDisconnectData = {
  body?: never;
  path: {
    platform: string;
  };
  query?: never;
  url: "/crm/{platform}/disconnect";
};

export type DeleteCrmByPlatformDisconnectResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCrmByPlatformSyncLogsData = {
  body?: never;
  path: {
    platform: string;
  };
  query?: never;
  url: "/crm/{platform}/sync-logs";
};

export type GetCrmByPlatformSyncLogsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCrmHubspotAuthorizeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/crm/hubspot/authorize";
};

export type GetCrmHubspotAuthorizeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetCrmSalesforceAuthorizeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/crm/salesforce/authorize";
};

export type GetCrmSalesforceAuthorizeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerRegisterData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/register";
};

export type PostAuthCustomerRegisterResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerLoginData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/login";
};

export type PostAuthCustomerLoginResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerLoginMfaData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/login/mfa";
};

export type PostAuthCustomerLoginMfaResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerLogoutData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/logout";
};

export type PostAuthCustomerLogoutResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerRefreshData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/refresh";
};

export type PostAuthCustomerRefreshResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerRequestPasswordResetData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/request-password-reset";
};

export type PostAuthCustomerRequestPasswordResetResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostAuthCustomerResetPasswordData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/reset-password";
};

export type PostAuthCustomerResetPasswordResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetAuthCustomerMeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/customer/me";
};

export type GetAuthCustomerMeResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSagasPostPublishingStartData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/sagas/post-publishing/start";
};

export type PostSagasPostPublishingStartResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSagasBySagaIdData = {
  body?: never;
  path: {
    sagaId: string;
  };
  query?: never;
  url: "/sagas/{sagaId}";
};

export type GetSagasBySagaIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSagasBySagaIdContinueData = {
  body?: never;
  path: {
    sagaId: string;
  };
  query?: never;
  url: "/sagas/{sagaId}/continue";
};

export type PostSagasBySagaIdContinueResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type PostSagasBySagaIdCompensateData = {
  body?: never;
  path: {
    sagaId: string;
  };
  query?: never;
  url: "/sagas/{sagaId}/compensate";
};

export type PostSagasBySagaIdCompensateResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSagasData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/sagas";
};

export type GetSagasResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSagasHealthData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/sagas/health";
};

export type GetSagasHealthResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetSagasMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/sagas/metrics";
};

export type GetSagasMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetMetricsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/metrics";
};

export type GetMetricsResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetHealthTenantByTenantIdProjectByProjectIdData = {
  body?: never;
  path: {
    tenantId: string;
    projectId: string;
  };
  query?: never;
  url: "/health/tenant/{tenantId}/project/{projectId}";
};

export type GetHealthTenantByTenantIdProjectByProjectIdResponses = {
  /**
   * Default Response
   */
  200: unknown;
};

export type GetData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/";
};

export type GetResponses = {
  /**
   * Default Response
   */
  200: unknown;
};
