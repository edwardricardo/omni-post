# Legacy Code Audit — apps/admin

**Date:** 2026-04-03

---

## Executive Summary

8 issues found. 0 CRITICAL, 1 HIGH, 4 MEDIUM, 3 LOW. All resolved. Grandfathering was already properly integrated — no fix needed.

---

## Issues Found and Fixed

### HIGH (1)

#### ADM-001 — Subscriptions page uses legacy BASIC/PRO/ENTERPRISE tiers

- **File:** `apps/admin/app/(dashboard)/subscriptions/page.tsx`
- **Lines:** 33, 51, 76, 213-214, 326-328
- **Type:** LEGACY_DISPLAY
- **Problem:** Interfaces `SubscriptionAccount` and `TrialAccount` used `subscription: "BASIC" | "PRO" | "ENTERPRISE"`. Change Plan had a tier select dropdown. Badge rendering used tier-based logic.
- **Fix:** Replaced `subscription` field with `plan?: { type, name, status, providers, pricePerMonth }`. Removed `tierBadgeVariant()`, replaced with `planBadgeVariant()`. Removed BASIC/PRO/ENTERPRISE select dropdown. Change Plan now shows "Coming soon" (requires billing API with providers/bundle).

---

### MEDIUM (4)

#### ADM-002 — Unused getAnalyticsOverview API method

- **File:** `apps/admin/lib/apiClient.ts`
- **Line:** 278
- **Type:** DEAD_CODE
- **Problem:** `getAnalyticsOverview()` method defined but never called in any production code.
- **Fix:** Removed method definition and unused `AnalyticsData` interface.

#### ADM-003 — SubscriptionSummary uses `any[]` types

- **File:** `apps/admin/lib/apiClient.ts`
- **Lines:** 86-87
- **Type:** STALE_TYPE
- **Problem:** `subscriptions: any[]` and `trials: any[]` — untyped arrays.
- **Fix:** Replaced with properly typed arrays including `plan` object fields.

#### ADM-004 — Test mock data uses legacy subscription field

- **File:** `apps/admin/tests/unit/hooks/useAccounts.test.tsx`
- **Type:** STALE_TYPE
- **Problem:** Mock data included `subscription: "PRO"` which no longer exists on Account.
- **Fix:** Already cleaned in previous session.

#### ADM-005 — DashboardStats.subscriptions type

- **File:** `apps/admin/lib/apiClient.ts`
- **Type:** STALE_TYPE
- **Problem:** Was `subscriptions: { basic, pro, enterprise }` — legacy tier counts.
- **Fix:** Already changed to `plans: { custom, bundle, trial, none }` in previous session.

---

### LOW (3)

#### ADM-006 — Orphaned ErrorBoundary component

- **File:** `apps/admin/components/shared/ErrorBoundary.tsx`
- **Type:** DEAD_COMPONENT
- **Fix:** Deleted (0 importers).

#### ADM-007 — Orphaned SkipLink + VisuallyHidden components

- **Files:** `components/shared/SkipLink.tsx`, `components/shared/VisuallyHidden.tsx`
- **Type:** DEAD_COMPONENT
- **Fix:** Deleted (0 importers each).

#### ADM-008 — Orphaned logout-button component

- **File:** `apps/admin/components/auth/logout-button.tsx`
- **Type:** DEAD_COMPONENT
- **Problem:** Sidebar handles logout now — component unused.
- **Fix:** Deleted (0 importers).

---

## Grandfathering Status

Already properly integrated — no fix needed:

- `useAccountBilling` hook includes `isGrandfathered`, `grandfathering.lockedPrice`, `grandfathering.currentListPrice`, `grandfathering.expiresAt`
- `AccountBillingPanel` shows warning badge with locked price and savings

---

## Dead Code Removed

| File                                           | Lines    | Reason                              |
| ---------------------------------------------- | -------- | ----------------------------------- |
| `components/shared/ErrorBoundary.tsx`          | ~50      | 0 importers                         |
| `components/shared/SkipLink.tsx`               | ~20      | 0 importers                         |
| `components/shared/VisuallyHidden.tsx`         | ~15      | 0 importers                         |
| `components/auth/logout-button.tsx`            | ~25      | 0 importers, sidebar handles logout |
| `lib/apiClient.ts` AnalyticsData interface     | ~10      | Unused                              |
| `lib/apiClient.ts` getAnalyticsOverview method | ~3       | Never called                        |
| **Total**                                      | **~123** |                                     |

---

## Build: 0 errors, 9/9 tasks | Tests: 351 files, 7,128 passing | 0 failures

## Ready for Layer 3

apps/admin is now aligned to the clean API. apps/client audit can proceed.
