# Legacy Code Audit — apps/client

**Date:** 2026-04-03

---

## Executive Summary

14 issues found. 0 CRITICAL, 1 HIGH, 2 MEDIUM, 11 LOW. All resolved.

---

## Issues Found and Fixed

### HIGH (1)

#### CLI-001 — Inbox missing AI triage features

- **Files:** `hooks/api/useInbox.ts`, `components/inbox/ConversationCard.tsx`, `components/inbox/MessageBubble.tsx`, `components/inbox/ConversationThread.tsx`, `components/inbox/ReplyComposer.tsx`
- **Type:** UNWIRED_FEATURE
- **Problem:** API's `TriageInboxMessageUseCase` adds `suggestedReplies`, `priority`, `messageType` to inbox messages but the UI didn't show them.
- **Fix:** Added `priority`, `messageType`, `suggestedReplies` fields to message types. Added priority dot indicator (URGENT=red, HIGH=orange) in ConversationCard. Added messageType badge (COMPLAINT=red, LEAD=green, QUESTION=blue) in ConversationCard. Added clickable suggested reply chips in MessageBubble that auto-fill the ReplyComposer.

---

### MEDIUM (2)

#### CLI-002 — useUsage hook uses legacy plan type

- **File:** `hooks/api/useUsage.ts`
- **Lines:** 16, 41
- **Type:** STALE_TYPE
- **Problem:** `plan: "BASIC" | "PRO" | "ENTERPRISE"` — legacy tier type. Default fallback `"BASIC"`.
- **Fix:** Changed to `plan: string` with default `"none"`.

#### CLI-003 — Sprint features verification

- **Type:** VERIFICATION
- **Result:** All sprint features already properly wired:
  - Repurpose proposals → `/api/backend/repurpose/proposals` ✅
  - Trend radar → `/api/backend/trends/radar` ✅
  - Referral → `/api/backend/referral/code` ✅

---

### LOW (11)

#### CLI-004 to CLI-014 — 11 orphaned components

| File                                                   | Lines      |
| ------------------------------------------------------ | ---------- |
| `components/ai/ContentCalendarGenerator.tsx`           | ~150       |
| `components/ai/PlatformVariantsGenerator.tsx`          | ~200       |
| `components/analytics/UniversalAnalyticsDashboard.tsx` | ~300       |
| `components/approvals/SubmitForReviewButton.tsx`       | ~50        |
| `components/providers/ProviderCard.tsx`                | ~80        |
| `components/settings/UsageMetricsPanel.tsx`            | ~100       |
| `components/shared/ErrorBoundary.tsx`                  | ~50        |
| `components/shared/SidebarNav.tsx`                     | ~200       |
| `components/shared/SkipLink.tsx`                       | ~20        |
| `components/shared/VisuallyHidden.tsx`                 | ~15        |
| `components/team/TeamMemberRow.test.tsx`               | ~30        |
| **Total**                                              | **~1,195** |

All deleted — 0 importers each.

---

## Sprint Features Wired

| Feature             | API Endpoint              | Client Hook/Fetch     | Page                    | Status               |
| ------------------- | ------------------------- | --------------------- | ----------------------- | -------------------- |
| Repurpose proposals | GET /repurpose/proposals  | Direct fetch in page  | /dashboard/ai/repurpose | ALREADY WIRED        |
| Trend radar         | GET /trends/radar         | Direct fetch in page  | /dashboard/ai/trends    | ALREADY WIRED        |
| Inbox AI triage     | TriageInboxMessageUseCase | useInbox + components | /dashboard/inbox        | WIRED (this session) |
| Referral program    | GET /referral/code        | Direct fetch in page  | /settings/referral      | ALREADY WIRED        |

---

## Dead Code Removed

~1,195 lines across 11 orphaned components.

---

## Build: 0 errors, 9/9 tasks | Tests: 351 files, 7,128 passing | 0 failures

---

## Three-Layer Cleanup Complete

| Layer       | Issues Fixed | Dead Code Removed | Tests     |
| ----------- | ------------ | ----------------- | --------- |
| apps/api    | 29 + 47 refs | ~500 lines        | 7,128     |
| apps/admin  | 8            | ~123 lines        | 7,128     |
| apps/client | 14           | ~1,195 lines      | 7,128     |
| **Total**   | **98**       | **~1,818 lines**  | **7,128** |
