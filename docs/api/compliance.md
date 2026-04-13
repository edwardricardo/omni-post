# OmniPost — Compliance API Reference

## Overview

The compliance domain implements GDPR/LGPD/CCPA/PIPEDA regulatory compliance, including configurable GDPR and security settings, a weighted compliance score (11 checks), Data Subject Access Request (DSAR) lifecycle management, data breach reporting with email notifications, and automated data retention cleanup. All service methods return `Result<T, E>` for error handling.

---

## API Layer (`apps/api/`)

### ComplianceService

**File:** `apps/api/src/compliance/ComplianceService.ts`
**Layer:** application
**Description:** Central compliance service managing GDPR/security settings (singleton upsert), compliance score calculation, DSAR request lifecycle (submit, acknowledge, complete, reject), and breach reporting with email notifications. Uses `Result<T, ComplianceError>` for all fallible operations.

#### Error Types

```typescript
type ComplianceError = "NOT_FOUND" | "VALIDATION_ERROR" | "RATE_LIMITED" | "DATABASE_ERROR";
```

#### Methods

| Method                    | Signature                                                                                                           | Returns                                                         | Description                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `getGdprSettings`         | `()`                                                                                                                | `Promise<GdprSettings>`                                         | Returns GDPR settings (creates singleton if absent)                                                  |
| `updateGdprSettings`      | `(data: Record<string, unknown>, updatedBy: string)`                                                                | `Promise<Result<unknown, ComplianceError>>`                     | Updates GDPR settings with validation (DPO type, retention days 30-3650, DSAR days 15-45)            |
| `getSecuritySettings`     | `()`                                                                                                                | `Promise<SecuritySettings>`                                     | Returns security settings (creates singleton if absent)                                              |
| `updateSecuritySettings`  | `(data: Record<string, unknown>, updatedBy: string)`                                                                | `Promise<Result<unknown, ComplianceError>>`                     | Updates security settings with validation (timeout 15-10080 min, attempts 3-20, password 6-128)      |
| `getComplianceScore`      | `()`                                                                                                                | `Promise<ComplianceScoreResult>`                                | Calculates weighted score from 11 checks (weights sum to 100)                                        |
| `getDsarRequests`         | `(filters: DsarFilters)`                                                                                            | `Promise<{ requests, total, page, limit }>`                     | Lists DSAR requests with filtering (status, type) and pagination                                     |
| `getDsarById`             | `(id: string)`                                                                                                      | `Promise<DsarRequest \| null>`                                  | Returns a single DSAR request with account info                                                      |
| `acknowledgeDsar`         | `(id: string, adminId: string)`                                                                                     | `Promise<Result<unknown, ComplianceError>>`                     | Transitions DSAR to IN_PROGRESS                                                                      |
| `completeDsar`            | `(id: string, adminId: string, exportUrl?: string)`                                                                 | `Promise<Result<unknown, ComplianceError>>`                     | Completes DSAR with optional export URL (7-day expiry)                                               |
| `rejectDsar`              | `(id: string, adminId: string, reason: string)`                                                                     | `Promise<Result<unknown, ComplianceError>>`                     | Rejects DSAR with reason                                                                             |
| `submitDsarRequest`       | `(data: { requestorEmail, requestorName?, type, accountId?, jurisdiction?, ipAddress? })`                           | `Promise<Result<{ id, deadlineAt, message }, ComplianceError>>` | Public DSAR submission with rate limiting (max 3 pending per email) and jurisdiction-aware deadlines |
| `getBreachReports`        | `(filters: BreachFilters)`                                                                                          | `Promise<{ reports, total, page, limit }>`                      | Lists breach reports with resolved filter and pagination                                             |
| `createBreachReport`      | `(data: { title, description, discoveredAt, severity, dataTypesAffected, affectedUserCount? }, reportedBy: string)` | `Promise<Result<unknown, ComplianceError>>`                     | Creates a new data breach report                                                                     |
| `sendBreachNotifications` | `(breachId: string, adminId: string)`                                                                               | `Promise<Result<{ notified, errors }, ComplianceError>>`        | Sends email notifications to all active accounts about a breach                                      |

**Has JSDoc:** ❌ No `@method` tags on individual methods (file-level JSDoc only).

#### Compliance Score Checks (11 checks, weights sum to 100)

| Key                    | Label                                 | Weight | Condition                                     |
| ---------------------- | ------------------------------------- | ------ | --------------------------------------------- |
| `privacy_policy_url`   | Privacy Policy URL configured         | 12     | `gdpr.privacyPolicyUrl !== null`              |
| `terms_of_service_url` | Terms of Service URL configured       | 8      | `gdpr.termsOfServiceUrl !== null`             |
| `dpo_configured`       | Data Protection Officer configured    | 12     | DPO type + email/URL match                    |
| `data_retention_set`   | Data retention policy active          | 10     | `retentionDays > 0 && enableAutoDataDeletion` |
| `right_to_erasure`     | Right to erasure enabled              | 10     | `gdpr.enableRightToErasure`                   |
| `data_export`          | Data export enabled                   | 10     | `gdpr.enableDataExport`                       |
| `audit_logs_active`    | Audit logs active (last 24h)          | 8      | `recentAuditCount > 0`                        |
| `session_timeout`      | Session timeout within 8 hours        | 8      | `security.sessionTimeoutMinutes <= 480`       |
| `login_protection`     | Login attempts limited to 10 or fewer | 8      | `security.maxLoginAttempts <= 10`             |
| `breach_notification`  | Breach notification enabled           | 7      | `gdpr.enableBreachNotification`               |
| `dsar_response_time`   | DSAR response within 30 days          | 7      | `gdpr.dsarResponseDays <= 30`                 |

#### Jurisdiction Deadline Mapping

| Jurisdiction | Response Deadline (days) |
| ------------ | ------------------------ |
| LGPD         | 15                       |
| CCPA         | 45                       |
| GDPR         | 30                       |
| PIPEDA       | 30                       |
| OTHER        | 30                       |

---

### DataRetentionService

**File:** `apps/api/src/compliance/DataRetentionService.ts`
**Layer:** application
**Description:** Automated data retention cleanup. Deletes expired audit logs based on `auditLogRetentionDays` and marks overdue DSAR requests as EXPIRED. Only runs when `enableAutoDataDeletion` is true.

#### Methods

| Method                | Signature | Returns                                                              | Description                                              |
| --------------------- | --------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `runRetentionCleanup` | `()`      | `Promise<{ auditLogsDeleted: number; expiredDsarRequests: number }>` | Deletes old audit logs and expires overdue DSAR requests |

**Has JSDoc:** ❌ No `@method` tags.

---

## REST Endpoints (`complianceRoutes.ts`)

### Admin Endpoints (require `requireAdminAuth` + `Permission.AUDIT_READ`)

| Method | Path                                         | Description                        |
| ------ | -------------------------------------------- | ---------------------------------- |
| GET    | `/api/admin/compliance/settings/gdpr`        | Get GDPR settings                  |
| PUT    | `/api/admin/compliance/settings/gdpr`        | Update GDPR settings               |
| GET    | `/api/admin/compliance/settings/security`    | Get security settings              |
| PUT    | `/api/admin/compliance/settings/security`    | Update security settings           |
| GET    | `/api/admin/compliance/score`                | Get compliance score (11 checks)   |
| GET    | `/api/admin/compliance/dsar`                 | List DSAR requests (filterable)    |
| GET    | `/api/admin/compliance/dsar/:id`             | Get DSAR detail                    |
| POST   | `/api/admin/compliance/dsar/:id/acknowledge` | Acknowledge DSAR                   |
| POST   | `/api/admin/compliance/dsar/:id/complete`    | Complete DSAR (optional exportUrl) |
| POST   | `/api/admin/compliance/dsar/:id/reject`      | Reject DSAR (requires reason)      |
| GET    | `/api/admin/compliance/breaches`             | List breach reports                |
| POST   | `/api/admin/compliance/breaches`             | Create breach report               |
| POST   | `/api/admin/compliance/breaches/:id/notify`  | Send breach notifications          |

### Public Endpoint (no auth)

| Method | Path                   | Description                                                   |
| ------ | ---------------------- | ------------------------------------------------------------- |
| POST   | `/api/compliance/dsar` | Submit a DSAR request (rate-limited: max 3 pending per email) |

---

## Validation Schemas (`complianceSchemas.ts`)

| Schema                         | Key Fields                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateGdprSettingsSchema`     | privacyPolicyUrl, dpoType (`INTERNAL`/`EXTERNAL`), dpoEmail, dataRetentionDays (30-3650), dsarResponseDays (15-45), defaultJurisdiction, enableRightToErasure, enableDataExport, enableBreachNotification |
| `updateSecuritySettingsSchema` | require2FA, sessionTimeoutMinutes (15-10080), maxLoginAttempts (3-20), passwordMinLength (6-128), ipAllowlistEnabled, ipAllowlist                                                                         |
| `dsarFiltersSchema`            | status (`PENDING`/`IN_PROGRESS`/`COMPLETED`/`REJECTED`/`EXPIRED`), type (`EXPORT`/`DELETION`/`ACCESS`), page, limit                                                                                       |
| `submitDsarSchema`             | email (required), name, type (`EXPORT`/`DELETION`/`ACCESS`), jurisdiction (`GDPR`/`LGPD`/`CCPA`/`PIPEDA`/`OTHER`), accountId                                                                              |
| `createBreachSchema`           | title, description, discoveredAt, severity (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), dataTypesAffected, affectedUserCount                                                                                       |
| `breachFiltersSchema`          | resolved (boolean), page, limit                                                                                                                                                                           |
| `rejectDsarSchema`             | reason (required)                                                                                                                                                                                         |
| `completeDsarSchema`           | exportUrl (optional URL)                                                                                                                                                                                  |

---

## Admin Portal (`apps/admin/`)

| File                                             | Type      | Description                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/(dashboard)/compliance/page.tsx`            | Page      | Compliance dashboard with score, GDPR settings, DSAR table, breach reports                                                                                                                                                                                                                                         |
| `components/compliance/GdprSettingsForm.tsx`     | Component | GDPR settings editor (DPO, retention, rights toggles)                                                                                                                                                                                                                                                              |
| `components/compliance/SecuritySettingsForm.tsx` | Component | Security settings editor (2FA, session timeout, password policy, IP allowlist)                                                                                                                                                                                                                                     |
| `components/compliance/DsarTable.tsx`            | Component | DSAR request table with acknowledge/complete/reject actions                                                                                                                                                                                                                                                        |
| `components/compliance/BreachTable.tsx`          | Component | Breach report table with notification sending                                                                                                                                                                                                                                                                      |
| `hooks/api/useCompliance.ts`                     | Hook      | TanStack Query hooks: `useCompliance`, `useGdprSettings`, `useUpdateGdprSettings`, `useSecuritySettings`, `useUpdateSecuritySettings`, `useComplianceScore`, `useDsarRequests`, `useAcknowledgeDsar`, `useCompleteDsar`, `useRejectDsar`, `useBreachReports`, `useCreateBreachReport`, `useSendBreachNotification` |

---

## Client Portal (`apps/client/`)

| File                                      | Type | Description                                                                                     |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `app/dashboard/settings/privacy/page.tsx` | Page | Privacy settings page with DSAR submission form                                                 |
| `hooks/api/usePrivacy.ts`                 | Hook | `useSubmitDsarRequest` — mutation hook for public DSAR submission (`POST /api/compliance/dsar`) |

---

## Analytics Cross-References

Files in `apps/api/src/analytics/` that reference compliance concepts:

| File                             | Reference                         |
| -------------------------------- | --------------------------------- |
| `roiCalculator.ts`               | Compliance cost tracking          |
| `performanceComparison/index.ts` | Compliance metrics in comparisons |
| `crossPlatform/trendAnalyzer.ts` | GDPR-aware trend analysis         |
| `crossPlatform/dataFetcher.ts`   | GDPR data subject counts          |
