# Sprint C — Compliance (GDPR + LGPD + CCPA/CPRA + PIPEDA) Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Add regulatory compliance infrastructure for EU and Americas market entry. GDPR-first strategy covers all markets (LGPD, CCPA, PIPEDA are subsets). Includes DSAR processing, breach notification, data retention, compliance scoring, and both admin and client-facing interfaces.

---

## Schema (5 enums + 5 models)

### Enums

- `DpoType` — INTERNAL, EXTERNAL
- `DsarRequestType` — EXPORT, DELETION, ACCESS
- `DsarStatus` — PENDING, IN_PROGRESS, COMPLETED, REJECTED, EXPIRED
- `JurisdictionType` — GDPR, LGPD, CCPA, PIPEDA, OTHER

### Models

| Model              | Purpose                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `GdprSettings`     | Singleton — privacy policy URLs, DPO config, retention, DSAR deadlines, feature toggles |
| `SecuritySettings` | Singleton — 2FA, session timeout, password policy, IP allowlist                         |
| `ConsentRecord`    | Per-user consent tracking with type, version, withdrawal                                |
| `DsarRequest`      | Data subject access requests with jurisdiction-aware deadlines                          |
| `DataBreachReport` | Breach reports with severity, notification tracking, resolution                         |

Migration: `infra/prisma/migrations/20260411010000_add_compliance_models/migration.sql`

---

## Compliance Score (11 checks, weights sum to 100)

| Check                | Weight | Passing when                          |
| -------------------- | ------ | ------------------------------------- |
| privacy_policy_url   | 12     | URL configured                        |
| terms_of_service_url | 8      | URL configured                        |
| dpo_configured       | 12     | INTERNAL+email or EXTERNAL+url        |
| data_retention_set   | 10     | Retention > 0 AND auto-delete enabled |
| right_to_erasure     | 10     | Feature enabled                       |
| data_export          | 10     | Feature enabled                       |
| audit_logs_active    | 8      | Audit logs in last 24h > 0            |
| session_timeout      | 8      | Timeout <= 480 min (8h)               |
| login_protection     | 8      | Max attempts <= 10                    |
| breach_notification  | 7      | Feature enabled                       |
| dsar_response_time   | 7      | Response days <= 30                   |

Replaces hardcoded formula in `AnalyticsDashboardHandlers.ts`.

---

## API Endpoints (14)

### Admin (requireAdminAuth)

| Method | Path                                         | Purpose                                  |
| ------ | -------------------------------------------- | ---------------------------------------- |
| GET    | `/api/admin/compliance/settings/gdpr`        | Get GDPR settings                        |
| PUT    | `/api/admin/compliance/settings/gdpr`        | Update GDPR settings                     |
| GET    | `/api/admin/compliance/settings/security`    | Get security settings                    |
| PUT    | `/api/admin/compliance/settings/security`    | Update security settings                 |
| GET    | `/api/admin/compliance/score`                | Get compliance score (11 checks)         |
| GET    | `/api/admin/compliance/dsar`                 | List DSAR requests (filtered)            |
| GET    | `/api/admin/compliance/dsar/:id`             | DSAR detail                              |
| POST   | `/api/admin/compliance/dsar/:id/acknowledge` | Acknowledge DSAR                         |
| POST   | `/api/admin/compliance/dsar/:id/complete`    | Complete DSAR (with optional export URL) |
| POST   | `/api/admin/compliance/dsar/:id/reject`      | Reject DSAR (with reason)                |
| GET    | `/api/admin/compliance/breaches`             | List breach reports                      |
| POST   | `/api/admin/compliance/breaches`             | Create breach report                     |
| POST   | `/api/admin/compliance/breaches/:id/notify`  | Send breach notifications                |

### Public (no auth)

| Method | Path                   | Purpose                                             |
| ------ | ---------------------- | --------------------------------------------------- |
| POST   | `/api/compliance/dsar` | Submit DSAR request (rate limited: 3 pending/email) |

---

## DSAR Lifecycle

```
Submit (public) → PENDING → Acknowledge → IN_PROGRESS → Complete/Reject
                                                     ↓
                                              EXPIRED (auto, via DataRetentionService)
```

Deadline by jurisdiction: LGPD=15d, CCPA=45d, GDPR/PIPEDA/OTHER=configurable (default 30d).

---

## Admin UI

### Compliance Page (5 tabs)

- **Overview**: Existing metric cards + NEW compliance checklist (11 checks, pass/fail, clickable to relevant tab)
- **GDPR**: Settings form + DSAR requests table with acknowledge/complete/reject actions
- **Security**: Settings form (2FA, session, password, IP allowlist)
- **Breaches**: Breach reports table + create dialog + send notifications action
- **Audit**: Unchanged

### Components Created

| Component                  | Lines | Purpose                                                          |
| -------------------------- | ----- | ---------------------------------------------------------------- |
| `GdprSettingsForm.tsx`     | 315   | Full GDPR settings form with DPO conditional fields              |
| `DsarTable.tsx`            | 325   | DSAR table with status badges, deadline warnings, action dialogs |
| `SecuritySettingsForm.tsx` | 244   | Security settings with IP allowlist textarea                     |
| `BreachTable.tsx`          | 342   | Breach table with create dialog, severity badges, notify action  |

---

## Client Privacy Page

**File:** `apps/client/app/dashboard/settings/privacy/page.tsx` (267 lines)

- "Your Privacy Rights" heading with plain-language explanation
- Form: request type (access/export/deletion), email (pre-filled), name, jurisdiction region
- Deletion warning callout
- On success: green confirmation card with reference ID and response deadline
- Navigation link added to client dashboard layout

---

## Files Summary

### New (10)

| File                                                        | Lines |
| ----------------------------------------------------------- | ----- |
| `apps/api/src/compliance/ComplianceService.ts`              | 599   |
| `apps/api/src/compliance/DataRetentionService.ts`           | 60    |
| `apps/api/src/compliance/complianceRoutes.ts`               | 291   |
| `apps/api/src/compliance/complianceSchemas.ts`              | 83    |
| `apps/admin/components/compliance/GdprSettingsForm.tsx`     | 315   |
| `apps/admin/components/compliance/DsarTable.tsx`            | 325   |
| `apps/admin/components/compliance/SecuritySettingsForm.tsx` | 244   |
| `apps/admin/components/compliance/BreachTable.tsx`          | 342   |
| `apps/client/app/dashboard/settings/privacy/page.tsx`       | 267   |
| `apps/client/hooks/api/usePrivacy.ts`                       | 49    |

### Modified (8)

| File                                                     | Changes                                               |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `infra/prisma/schema.prisma`                             | +4 enums, +5 models, +1 Account relation              |
| `infra/prisma/seed.ts`                                   | +2 singleton upserts (GdprSettings, SecuritySettings) |
| `apps/api/src/index.ts`                                  | +complianceRoutes registration                        |
| `apps/api/src/infrastructure/container/types.ts`         | +2 DI tokens                                          |
| `apps/api/src/infrastructure/container/setupServices.ts` | +2 service registrations                              |
| `apps/api/src/admin/AnalyticsDashboardHandlers.ts`       | Delegated score to ComplianceService                  |
| `apps/admin/app/(dashboard)/compliance/page.tsx`         | Replaced Coming Soon, added Breaches tab              |
| `apps/admin/hooks/api/useCompliance.ts`                  | +12 hooks                                             |
| `apps/admin/messages/en.json` + `es.json`                | Expanded compliance i18n section                      |
| `apps/client/app/dashboard/layout.tsx`                   | Added Privacy nav link                                |

---

## Quality Gates

| Check                            | Result                                    |
| -------------------------------- | ----------------------------------------- |
| TypeScript build                 | 9/9 tasks, 0 errors                       |
| ESLint                           | 0 errors, 0 warnings                      |
| Compliance models in schema      | 5                                         |
| "Coming Soon" in compliance page | 0                                         |
| Client privacy page exists       | Yes                                       |
| Max file length                  | 599 lines (ComplianceService) — under 800 |
| `any` in compliance files        | 0                                         |
| `throw` in ComplianceService     | 0                                         |
