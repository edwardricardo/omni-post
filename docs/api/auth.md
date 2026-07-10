# OmniPost -- Authentication & Authorization API Reference

## Overview

OmniPost implements a dual-track authentication system: admin authentication (session-based with JWT) and customer authentication (stateless JWT). The security stack includes RBAC with DB-driven configurable roles, TOTP-based MFA with backup codes, SAML 2.0 SSO, OpenID Connect SSO with PKCE, brute force protection with progressive delays, and device fingerprinting.

---

## API Layer (`apps/api/`)

### AuthService (Facade)

**File:** `apps/api/src/auth/authService.ts`
**Layer:** infrastructure
**Description:** Unified authentication facade composing `AuthServiceCore` (registration, login, MFA flow) and `AuthServiceSession` (token refresh, verification, session management) into a single public API. Registered in DI as `TOKENS.AuthService`.

#### Methods

| Method              | Signature                                                                                                | Returns                                                                                  | Description                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `registerAdmin`     | `(email, password, name, role?): Promise<Result<AuthenticatedUser, ...>>`                                | `Result<AuthenticatedUser, "EMAIL_EXISTS" \| "VALIDATION_ERROR" \| "DATABASE_ERROR">`    | Creates admin user with hashed password and role assignment |
| `login`             | `(credentials, ipAddress?, userAgent?, fingerprint?): Promise<Result<LoginResult \| MfaChallenge, ...>>` | `Result<{ user, tokens } \| { mfaRequired, userId }, ...>`                               | Authenticates with optional MFA challenge flow              |
| `refreshTokens`     | `(refreshToken, ipAddress?, fingerprint?): Promise<Result<AuthTokens, ...>>`                             | `Result<AuthTokens, "INVALID_TOKEN" \| "TOKEN_BLACKLISTED" \| "SESSION_EXPIRED" \| ...>` | Issues new access/refresh token pair                        |
| `verifyAccessToken` | `(token, fingerprint?): Promise<Result<AuthenticatedUser, ...>>`                                         | `Result<AuthenticatedUser, ...>`                                                         | Validates JWT and returns authenticated user                |
| `logout`            | `(refreshToken): Promise<Result<void, ...>>`                                                             | `Result<void, "SESSION_NOT_FOUND" \| "DATABASE_ERROR">`                                  | Invalidates session and blacklists token                    |
| `revokeAllSessions` | `(userId): Promise<Result<number, "DATABASE_ERROR">>`                                                    | `Result<number, "DATABASE_ERROR">`                                                       | Revokes all active sessions for a user                      |
| `getUserSessions`   | `(userId): Promise<Result<AdminSession[], "DATABASE_ERROR">>`                                            | `Result<AdminSession[], "DATABASE_ERROR">`                                               | Lists all sessions for a user                               |

**Has JSDoc:** &#9989;

---

### Auth Routes (Admin)

**File:** `apps/api/src/auth/authRoutes.ts`
**Layer:** infrastructure
**Description:** Fastify route plugin for admin authentication: registration, login, token refresh, logout, and session management. Rate-limited on sensitive endpoints.

#### Routes

| Method | Path               | Auth   | Rate Limit | Description                          |
| ------ | ------------------ | ------ | ---------- | ------------------------------------ |
| `POST` | `/auth/register`   | None   | 10/hour    | Register new admin user              |
| `POST` | `/auth/login`      | None   | 5/15min    | Admin login (supports MFA challenge) |
| `POST` | `/auth/refresh`    | None   | 20/15min   | Refresh JWT access token             |
| `POST` | `/auth/logout`     | None   | 20/15min   | Logout (clears refresh token cookie) |
| `GET`  | `/auth/me`         | Client | --         | Get current authenticated user       |
| `GET`  | `/auth/sessions`   | Client | --         | List user sessions (sanitized)       |
| `POST` | `/auth/revoke-all` | Client | --         | Revoke all user sessions             |

**Has JSDoc:** &#9989; (all handler methods)

---

### Customer Auth Routes

**File:** `apps/api/src/auth/customerAuthRoutes.ts`
**Layer:** infrastructure
**Description:** Customer-facing authentication with separate JWT secrets from admin auth. Delegates to application-layer use cases via DI.

#### Routes

| Method | Path                                    | Auth   | Rate Limit | Description                             |
| ------ | --------------------------------------- | ------ | ---------- | --------------------------------------- |
| `POST` | `/auth/customer/register`               | None   | 10/hour    | Register account + user, returns tokens |
| `POST` | `/auth/customer/login`                  | None   | 5/15min    | Customer login                          |
| `POST` | `/auth/customer/logout`                 | Client | --         | Customer logout                         |
| `POST` | `/auth/customer/refresh`                | None   | 20/15min   | Refresh customer tokens                 |
| `POST` | `/auth/customer/request-password-reset` | None   | 5/15min    | Request password reset email            |
| `POST` | `/auth/customer/reset-password`         | None   | 5/15min    | Reset password with token               |
| `GET`  | `/auth/customer/me`                     | Client | --         | Get current customer user               |

#### Use Cases Consumed

| Token                                | Use Case                      | Description                                   |
| ------------------------------------ | ----------------------------- | --------------------------------------------- |
| `TOKENS.RegisterCustomerUseCase`     | `RegisterCustomerUseCase`     | Creates Account + User + tokens               |
| `TOKENS.LoginCustomerUseCase`        | `LoginCustomerUseCase`        | Authenticates customer, handles multi-account |
| `TOKENS.RefreshCustomerTokenUseCase` | `RefreshCustomerTokenUseCase` | Issues new token pair                         |
| `TOKENS.LogoutCustomerUseCase`       | `LogoutCustomerUseCase`       | Acknowledges logout                           |
| `TOKENS.RequestPasswordResetUseCase` | `RequestPasswordResetUseCase` | Generates reset token                         |
| `TOKENS.ResetPasswordUseCase`        | `ResetPasswordUseCase`        | Validates token, updates password             |

**Has JSDoc:** &#9989; (all handler methods with `@method` tags)

---

### MfaService

**File:** `apps/api/src/auth/mfaService.ts`
**Layer:** infrastructure
**Description:** Multi-factor authentication service using TOTP (via `otplib`) with QR code generation, backup code management (SHA-256 hashed, 8 codes), and security audit logging. Extends `AuditableService`.

#### Methods

| Method                  | Signature                                                       | Returns                                                           | Description                                                    |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `setupMfa`              | `(userId, userEmail): Promise<Result<MfaSetupData, ...>>`       | `Result<{ secret, backupCodes, qrCodeUrl, manualEntryKey }, ...>` | Generates TOTP secret, QR code, and 8 backup codes             |
| `verifyMfaSetup`        | `(userId, token): Promise<Result<{ backupCodes }, ...>>`        | `Result<{ backupCodes: string[] }, ...>`                          | Validates TOTP token and enables MFA for the user              |
| `verifyMfaToken`        | `(userId, token): Promise<Result<MfaVerificationResult, ...>>`  | `Result<{ verified, usedBackupCode? }, ...>`                      | Verifies TOTP or backup code during login (2-window tolerance) |
| `disableMfa`            | `(userId, token): Promise<Result<void, ...>>`                   | `Result<void, ...>`                                               | Requires valid TOTP to disable MFA                             |
| `adminForceDisable`     | `(userId): Promise<Result<void, ...>>`                          | `Result<void, "USER_NOT_FOUND" \| "DATABASE_ERROR">`              | Emergency admin override -- no TOTP required                   |
| `regenerateBackupCodes` | `(userId, token): Promise<Result<string[], ...>>`               | `Result<string[], ...>`                                           | Generates 8 new backup codes (invalidates old ones)            |
| `getMfaStatus`          | `(userId): Promise<Result<{ enabled, backupCodesCount }, ...>>` | `Result<{ enabled: boolean; backupCodesCount: number }, ...>`     | Returns MFA status and remaining backup codes                  |

**Has JSDoc:** &#9989; (all public methods)

---

### MFA Routes

**File:** `apps/api/src/auth/mfaRoutes.ts`
**Layer:** infrastructure
**Description:** MFA endpoints for both customer users and admin management. Includes setup, verification, backup code regeneration, and admin force-disable.

#### Routes

| Method | Path                                     | Auth                  | Description                                    |
| ------ | ---------------------------------------- | --------------------- | ---------------------------------------------- |
| `GET`  | `/auth/mfa/status`                       | Client                | Get MFA status for current user                |
| `POST` | `/auth/mfa/setup`                        | Client                | Initiate MFA setup (returns QR code)           |
| `POST` | `/auth/mfa/verify-setup`                 | Client                | Verify MFA setup with 6-digit TOTP             |
| `POST` | `/auth/customer/login/mfa`               | None                  | Complete customer login MFA challenge (step 2) |
| `POST` | `/auth/mfa/disable`                      | Client                | Disable MFA (requires valid TOTP/backup code)  |
| `POST` | `/auth/mfa/regenerate-backup-codes`      | Client                | Generate new backup codes                      |
| `GET`  | `/admin/users/:userId/mfa/status`        | Admin + `USER_MANAGE` | Admin: check any user's MFA status             |
| `POST` | `/admin/users/:userId/mfa/force-disable` | Admin + `USER_MANAGE` | Admin: emergency MFA disable (requires reason) |

**Has JSDoc:** &#9989;

---

### RbacService

**File:** `apps/api/src/auth/rbacService.ts`
**Layer:** application
**Description:** DB-driven role-based access control. Roles and permissions are stored in the `Role` / `RolePermission` tables. `SUPER_ADMIN` always receives all permissions regardless of DB contents. Permissions are cached for 60 seconds.

#### Permissions (18 total)

| Category           | Permissions                                     |
| ------------------ | ----------------------------------------------- |
| User Management    | `user:read`, `user:manage`, `user:manage_roles` |
| Dashboard          | `dashboard:view`                                |
| Account Management | `account:read`, `account:manage`                |
| Billing            | `billing:read`, `billing:manage`                |
| Post Management    | `post:manage`                                   |
| Pricing            | `pricing:manage`                                |
| Analytics          | `analytics:read`, `analytics:export`            |
| System             | `system:configure`, `system:monitor`            |
| Audit              | `audit:read`, `audit:export`                    |
| Webhooks           | `webhook:manage`                                |

#### Methods

| Method                    | Signature                                                           | Returns                                                                           | Description                                      |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `hasPermission`           | `(userRole, permission): Promise<boolean>`                          | `boolean`                                                                         | Check single permission for a role               |
| `hasAnyPermission`        | `(userRole, permissions): Promise<boolean>`                         | `boolean`                                                                         | Check if role has any of the listed permissions  |
| `hasAllPermissions`       | `(userRole, permissions): Promise<boolean>`                         | `boolean`                                                                         | Check if role has all listed permissions         |
| `getUserPermissions`      | `(userId, userRole): Promise<UserPermissions>`                      | `UserPermissions`                                                                 | Full permission set with `canAccess()` helper    |
| `getRoleInfo`             | `(roleName): Promise<Result<RoleInfo, ...>>`                        | `Result<RoleInfo, "ROLE_NOT_FOUND" \| "DATABASE_ERROR">`                          | Role details including user count                |
| `getAllRoles`             | `(): Promise<Result<RoleInfo[], "DATABASE_ERROR">>`                 | `Result<RoleInfo[], "DATABASE_ERROR">`                                            | All active roles ordered by level                |
| `updateUserRole`          | `(adminId, targetId, roleName, reason): Promise<Result<void, ...>>` | `Result<void, ...>`                                                               | SUPER_ADMIN only; prevents self-modification     |
| `getUsersByRole`          | `(roleName): Promise<Result<UserList, ...>>`                        | `Result<Array<{ id, email, name, role, isActive, lastLoginAt, createdAt }>, ...>` | List all users with a given role                 |
| `getPermissionCategories` | `(): Record<string, Permission[]>`                                  | `Record<string, Permission[]>`                                                    | Grouped permissions for UI display               |
| `canModifyRole`           | `(adminRole, targetRole): Promise<boolean>`                         | `boolean`                                                                         | Hierarchy-based privilege escalation prevention  |
| `invalidateCache`         | `(roleName?): void`                                                 | `void`                                                                            | Clear permission cache for specific or all roles |

**Has JSDoc:** &#9989; (all public methods)

---

### RBAC Routes

**File:** `apps/api/src/auth/rbacRoutes.ts`
**Layer:** infrastructure
**Description:** RBAC endpoints for permission queries, role management, hierarchy inspection, and role CRUD (SUPER_ADMIN only).

#### Routes

| Method   | Path                                    | Permission          | Description                                    |
| -------- | --------------------------------------- | ------------------- | ---------------------------------------------- |
| `GET`    | `/auth/permissions`                     | Admin auth          | Get current user permissions                   |
| `POST`   | `/auth/permissions/check`               | Admin auth          | Check specific permissions (requireAll option) |
| `GET`    | `/admin/rbac/roles`                     | `USER_READ`         | List all roles with permissions                |
| `GET`    | `/admin/rbac/roles/:role`               | `USER_READ`         | Get specific role info                         |
| `GET`    | `/admin/rbac/roles/:role/users`         | `USER_READ`         | List users assigned to a role                  |
| `GET`    | `/admin/rbac/hierarchy`                 | `USER_READ`         | Full permission hierarchy and role comparison  |
| `GET`    | `/admin/rbac/status`                    | `USER_READ`         | RBAC system stats (users, roles, distribution) |
| `PUT`    | `/admin/rbac/users/:userId/role`        | `USER_MANAGE_ROLES` | Update a user's role                           |
| `POST`   | `/admin/rbac/roles`                     | `USER_MANAGE_ROLES` | Create a new custom role                       |
| `PUT`    | `/admin/rbac/roles/:roleId`             | `USER_MANAGE_ROLES` | Update role metadata (description, level)      |
| `PUT`    | `/admin/rbac/roles/:roleId/permissions` | `USER_MANAGE_ROLES` | Bulk replace role permissions                  |
| `DELETE` | `/admin/rbac/roles/:roleId`             | `USER_MANAGE_ROLES` | Delete a custom role (not system roles)        |

**Has JSDoc:** &#9989;

---

### BruteForceProtection

**File:** `apps/api/src/auth/bruteForceProtection.ts`
**Layer:** infrastructure
**Description:** Redis-backed brute force protection with progressive exponential delays, per-email and per-IP failure tracking, account lockout, IP blocking, CAPTCHA threshold support, and anomaly detection (rapid failures, distributed attacks, credential stuffing).

#### Methods

| Method                    | Signature                                                  | Returns                                                                | Description                                                                  |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `checkLoginAttempt`       | `(email, ipAddress, userAgent): Promise<ProtectionResult>` | `ProtectionResult`                                                     | Evaluates if attempt is allowed, calculates delay and CAPTCHA requirement    |
| `recordFailedAttempt`     | `(email, ipAddress, userAgent, reason): Promise<void>`     | `void`                                                                 | Records failure, checks lockout/block conditions, triggers anomaly detection |
| `recordSuccessfulAttempt` | `(email, ipAddress, userAgent): Promise<void>`             | `void`                                                                 | Clears failure counters for email and IP                                     |
| `checkAccountLockout`     | `(email): Promise<ProtectionResult>`                       | `ProtectionResult`                                                     | Checks if account is locked (with expiration)                                |
| `checkIpBlock`            | `(ipAddress): Promise<ProtectionResult>`                   | `ProtectionResult`                                                     | Checks if IP is blocked (with expiration)                                    |
| `unlockAccount`           | `(email, adminUserId): Promise<boolean>`                   | `boolean`                                                              | Admin override to unlock a locked account                                    |
| `unblockIpAddress`        | `(ipAddress, adminUserId): Promise<boolean>`               | `boolean`                                                              | Admin override to unblock an IP                                              |
| `getProtectionStats`      | `(): Promise<ProtectionStats>`                             | `{ lockedAccounts, blockedIps, recentFailures, suspiciousActivities }` | Monitoring dashboard data                                                    |

#### Default Configuration

| Setting              | Value                        |
| -------------------- | ---------------------------- |
| Max failed per email | 5                            |
| Max failed per IP    | 20                           |
| Failure window       | 15 minutes                   |
| Lockout threshold    | 10 attempts                  |
| Lockout duration     | 30 minutes                   |
| IP block threshold   | 50 attempts                  |
| IP block duration    | 60 minutes                   |
| CAPTCHA threshold    | 3 attempts                   |
| Delay                | Exponential base 2, max 300s |

**Has JSDoc:** &#9989; (all public methods)

---

### SAML SSO

**File:** `apps/api/src/auth/samlRoutes.ts`
**Layer:** infrastructure
**Description:** SAML 2.0 SSO implementation using `@node-saml/node-saml`. Supports SP metadata generation, IdP-initiated login redirect, and SAML Response callback with configurable attribute mapping.

#### Routes

| Method | Path                             | Auth  | Description                                                                |
| ------ | -------------------------------- | ----- | -------------------------------------------------------------------------- |
| `GET`  | `/auth/saml/:accountId/metadata` | None  | SP metadata XML for IdP configuration                                      |
| `GET`  | `/auth/saml/:accountId/login`    | None  | Redirect to IdP with AuthnRequest                                          |
| `POST` | `/auth/saml/:accountId/callback` | None  | Receive SAML Response, validate, create session                            |
| `GET`  | `/api/saml/config`               | Admin | Get SAML configuration for account                                         |
| `PUT`  | `/api/saml/config`               | Admin | Configure IdP settings (entityId, SSO URL, certificate, attribute mapping) |
| `POST` | `/api/saml/enable`               | Admin | Enable SSO for account                                                     |
| `POST` | `/api/saml/disable`              | Admin | Disable SSO for account                                                    |

**Has JSDoc:** &#9989;

---

### OpenID Connect SSO

**File:** `apps/api/src/auth/oidcRoutes.ts`
**Layer:** infrastructure
**Description:** OIDC SSO implementation with PKCE (S256 code challenge). Uses `openid-client` for provider discovery, authorization code exchange, and UserInfo fetching. In-memory PKCE state store (10-minute TTL).

#### Routes

| Method | Path                             | Auth  | Description                                                                  |
| ------ | -------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `GET`  | `/auth/oidc/:accountId/login`    | None  | Generate authorization URL with PKCE, redirect to IdP                        |
| `GET`  | `/auth/oidc/:accountId/callback` | None  | Exchange code for tokens, fetch UserInfo, create session                     |
| `GET`  | `/api/oidc/config`               | Admin | Get OIDC configuration (clientSecret masked)                                 |
| `PUT`  | `/api/oidc/config`               | Admin | Configure OIDC IdP (issuer URL, client ID/secret, scopes, attribute mapping) |
| `POST` | `/api/oidc/enable`               | Admin | Enable OIDC SSO                                                              |
| `POST` | `/api/oidc/disable`              | Admin | Disable OIDC SSO                                                             |

**Has JSDoc:** &#9989;

---

## Supporting Services

### AuthServiceCore

**File:** `apps/api/src/auth/authServiceCore.ts`
**Layer:** infrastructure
**Description:** Core authentication logic: password hashing (bcrypt), user creation, credential validation, and MFA challenge integration.

**Has JSDoc:** &#9989;

### AuthServiceSession

**File:** `apps/api/src/auth/authServiceSession.ts`
**Layer:** infrastructure
**Description:** Session lifecycle management: JWT signing/verification, refresh token rotation, session creation/expiration, token blacklisting via Redis.

**Has JSDoc:** &#9989;

### DeviceFingerprint

**File:** `apps/api/src/auth/deviceFingerprint.ts`
**Layer:** infrastructure
**Description:** Device fingerprint generation and validation for session binding.

### ConnectionManager

**File:** `apps/api/src/auth/connectionManager.ts`
**Layer:** infrastructure
**Description:** Manages concurrent session limits and connection tracking.

### CustomerJwt

**File:** `apps/api/src/auth/customerJwt.ts`
**Layer:** infrastructure
**Description:** Customer-specific JWT signing and verification with separate secrets.

### RoleManagementService

**File:** `apps/api/src/auth/roleManagementService.ts`
**Layer:** infrastructure
**Description:** Role CRUD operations: create, update, delete roles; set permissions; validates UPPER_SNAKE_CASE naming, level constraints, and system role protections.

---

## Middleware

### requireAdminAuth

**File:** `apps/api/src/admin/auth/adminAuthMiddleware.ts`
**Description:** Fastify preHandler that verifies admin JWT and populates `request.auth.user`.

### requireClientAuth

**File:** `apps/api/src/auth/customerAuthMiddleware.ts`
**Description:** Fastify preHandler that verifies customer JWT and populates `request.customerUser`.

### requirePermission

**File:** `apps/api/src/auth/rbacMiddleware.ts`
**Description:** Fastify preHandler factory that checks RBAC permissions. Usage: `requirePermission(Permission.ANALYTICS_READ)`.

### integrationAuthMiddleware

**File:** `apps/api/src/auth/integrationAuthMiddleware.ts`
**Description:** API key authentication for external integrations.

---

## Application Layer Use Cases

**Directory:** `apps/api/src/application/auth/`

| Use Case                    | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `ConfigureSamlUseCase`      | Validates and stores SAML IdP configuration          |
| `EnableSsoUseCase`          | Activates SSO for an account (requires valid config) |
| `DisableSsoUseCase`         | Deactivates SSO for an account                       |
| `GetSamlConfigurationQuery` | Reads SAML configuration for an account              |
| `ConfigureOidcUseCase`      | Validates and stores OIDC provider configuration     |
| `EnableOidcSsoUseCase`      | Activates OIDC SSO for an account                    |
| `DisableOidcSsoUseCase`     | Deactivates OIDC SSO for an account                  |
| `GetOidcConfigurationQuery` | Reads OIDC configuration for an account              |

**Directory:** `apps/api/src/application/customer-auth/`

| Use Case                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `RegisterCustomerUseCase`     | Creates Account + User + JWT tokens             |
| `LoginCustomerUseCase`        | Authenticates, handles multi-account resolution |
| `RefreshCustomerTokenUseCase` | Validates refresh token, issues new pair        |
| `LogoutCustomerUseCase`       | Acknowledges customer logout                    |
| `RequestPasswordResetUseCase` | Generates time-limited reset token              |
| `ResetPasswordUseCase`        | Validates token and updates password hash       |

---

## API Key Authentication

**File:** `apps/api/src/auth/apiKeyRoutes.ts`
**Layer:** infrastructure
**Description:** API key CRUD endpoints for programmatic access.

### Provider OAuth

| File                                         | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| `apps/api/src/auth/providerOAuth.ts`         | OAuth flow orchestration for social providers        |
| `apps/api/src/auth/providerOAuthFlow.ts`     | OAuth redirect and callback handling                 |
| `apps/api/src/auth/providerOAuthConfigs.ts`  | Per-provider OAuth configuration (scopes, URLs)      |
| `apps/api/src/auth/enhancedOAuthProvider.ts` | Enhanced OAuth with token refresh and error handling |

---

## Key Implementation Notes

- **Dual auth tracks:** Admin and customer auth use separate JWT secrets, middleware, and route prefixes
- **DB-driven RBAC:** Roles and permissions are stored in `Role` / `RolePermission` tables, not hardcoded (except `SUPER_ADMIN` which always gets all permissions)
- **Permission cache:** 60-second TTL, invalidated on role mutations
- **MFA:** TOTP with 2-window tolerance (1 minute each direction), 8 backup codes (SHA-256 hashed)
- **Brute force:** Exponential backoff, per-email and per-IP tracking, anomaly detection for distributed attacks
- **SSO:** Both SAML 2.0 and OIDC with PKCE supported simultaneously
- **Rate limiting:** Applied to all public auth endpoints via Fastify `rateLimit` config
- **Audit logging:** All security-sensitive operations logged via `AuditableService`
