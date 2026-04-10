# RBAC Permission Cleanup Report

Date: 2026-04-09

## Summary

Replaced 27 decorative permissions with 16 real ones mapped to actual admin features.
Migrated ~70 route preHandlers from role-based (`requireAdmin`/`requireSuperAdmin`) to permission-based (`requirePermission(Permission.XXX)`).

## Permission Changes

### Removed (14 — no admin features)

`project:create/read/update/delete`, `content:create/read/update/delete/publish`, `ai:use/configure`, `support:read/respond`, `system:backup`

### Consolidated

`user:create` + `user:update` + `user:delete` → `user:manage`

### Added (5 — real features without permission)

`account:read`, `account:manage`, `subscription:manage`, `pricing:manage`, `webhook:manage`

### Final 16 Permissions

| Category                | Permissions                                       |
| ----------------------- | ------------------------------------------------- |
| User Management         | user:read, user:manage, user:manage_roles         |
| Account Management      | account:read, account:manage                      |
| Billing & Subscriptions | billing:read, billing:manage, subscription:manage |
| Pricing                 | pricing:manage                                    |
| Analytics               | analytics:read, analytics:export                  |
| System                  | system:configure, system:monitor                  |
| Audit & Compliance      | audit:read, audit:export                          |
| Webhooks                | webhook:manage                                    |

## Role Assignments (DB verified)

| Role        | Count | Permissions                                                                  |
| ----------- | ----- | ---------------------------------------------------------------------------- |
| SUPER_ADMIN | 16    | All                                                                          |
| ADMIN       | 12    | All except user:manage_roles, pricing:manage, system:configure, audit:export |
| SUPPORT     | 5     | user:read, account:read, billing:read, analytics:read, audit:read            |

## Route Files Migrated (10 files, ~70 preHandlers)

| File                      | Routes | Permission Mapping                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------- |
| accountLifecycleRoutes.ts | 16     | ACCOUNT_READ, ACCOUNT_MANAGE, BILLING_READ, BILLING_MANAGE          |
| adminUserRoutes.ts        | 6      | USER_READ, USER_MANAGE                                              |
| subscriptionRoutes.ts     | 17     | BILLING_READ, SUBSCRIPTION_MANAGE, BILLING_MANAGE, ANALYTICS_EXPORT |
| analyticsRoutes.ts        | 5      | ANALYTICS_READ, AUDIT_READ, ACCOUNT_MANAGE                          |
| auditRoutes.ts            | 8      | AUDIT_READ, AUDIT_EXPORT, SYSTEM_CONFIGURE                          |
| pricingRoutes.ts          | 10     | BILLING_READ, PRICING_MANAGE                                        |
| rbacRoutes.ts             | 10     | USER_READ, USER_MANAGE_ROLES                                        |
| channelRoutes.ts          | 1      | ACCOUNT_MANAGE                                                      |
| webhookDashboardRoutes.ts | 8      | WEBHOOK_MANAGE                                                      |
| adminAuthRoutes.ts        | 1      | SYSTEM_CONFIGURE                                                    |
| dashboardRoutes.ts        | 0      | Unchanged (requireAdminAuth only)                                   |

## Frontend Updated

- PermissionGrid: 9 categories → 8 categories matching new enum
- hasPermission checks: user:create/update → user:manage, user:create → account:manage
- i18n: Category labels updated in en.json and es.json
- Test helpers: Updated permission arrays in seedSystemRoles.ts, mockPrisma.ts, rbacRoutes.test.ts

## Migration

File: `infra/prisma/migrations/20260409000000_rbac_permission_cleanup/migration.sql`

- Deletes 14 removed permissions
- Consolidates user:create/update/delete → user:manage
- Inserts new permissions for all 3 system roles
- Idempotent (ON CONFLICT DO NOTHING)

## Verification

- API build: 0 TypeScript errors
- Admin build: 0 TypeScript errors
- Migration: Applied successfully
- DB verified: SUPER_ADMIN 16, ADMIN 12, SUPPORT 5
- Old permissions in code: 0
- requireAdmin/requireSuperAdmin in route files: 0
