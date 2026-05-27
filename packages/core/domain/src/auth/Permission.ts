/**
 * @file Permission.ts
 * @description Admin RBAC permission enum. Promoted to @core/domain so
 *   role-management code can live in @core/application without depending
 *   on the apps/api `rbacService.ts` module (which carries Fastify + cache
 *   adapter wiring). Permission values are stable string identifiers used
 *   on the wire (audit logs, role-permission rows).
 * @layer domain
 */

export enum Permission {
  // Admin user management
  USER_READ = "user:read",
  USER_MANAGE = "user:manage",
  USER_MANAGE_ROLES = "user:manage_roles",

  // Dashboard
  DASHBOARD_VIEW = "dashboard:view",

  // Customer account management
  ACCOUNT_READ = "account:read",
  ACCOUNT_MANAGE = "account:manage",

  // Billing & subscriptions
  BILLING_READ = "billing:read",
  BILLING_MANAGE = "billing:manage",

  // Post management
  POST_MANAGE = "post:manage",

  // Pricing configuration
  PRICING_MANAGE = "pricing:manage",

  // Analytics & monitoring
  ANALYTICS_READ = "analytics:read",
  ANALYTICS_EXPORT = "analytics:export",

  // System administration
  SYSTEM_CONFIGURE = "system:configure",
  SYSTEM_MONITOR = "system:monitor",

  // Audit & compliance
  AUDIT_READ = "audit:read",
  AUDIT_EXPORT = "audit:export",

  // Webhooks
  WEBHOOK_MANAGE = "webhook:manage",

  // Secrets rotation status
  SECRETS_VIEW = "secrets:view",

  // Channel admin actions (force re-auth)
  CHANNELS_FORCE_REAUTH = "channels:force_reauth",

  // Webhook subscription admin (rotate signing secret)
  WEBHOOKS_ROTATE_SECRET = "webhooks:rotate_secret",

  // OIDC admin (replace client secret with handshake test)
  OIDC_REPLACE_SECRET = "oidc:replace_secret",

  // ApiKey admin (cross-tenant rotation)
  APIKEYS_ADMIN_ROTATE = "apikeys:admin_rotate",

  // Provider admin — cross-tenant mass force-reauth (post platform-secret rotation)
  PROVIDERS_MASS_FORCE_REAUTH = "providers:mass_force_reauth",
}
