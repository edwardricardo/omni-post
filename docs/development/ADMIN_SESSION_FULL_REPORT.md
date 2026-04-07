# Admin Portal — Full Session Report

**Date:** 2026-04-04 to 2026-04-05
**Duration:** Multi-day session across multiple conversation windows
**Scope:** Complete admin portal investigation, bug fixes, features, UI audit, code quality, i18n, and recovery from a critical data loss incident

---

## Table of Contents

1. [Session Timeline](#session-timeline)
2. [Investigation Phase](#investigation-phase)
3. [Bug Fixes Phase](#bug-fixes-phase)
4. [Feature Development Phase](#feature-development-phase)
5. [UI Audit & Polish Phase](#ui-audit--polish-phase)
6. [Code Quality Audit Phase](#code-quality-audit-phase)
7. [Internationalization Phase](#internationalization-phase)
8. [Critical Incident: Data Loss & Recovery](#critical-incident-data-loss--recovery)
9. [Infrastructure Issues Resolved](#infrastructure-issues-resolved)
10. [Final State](#final-state)
11. [Lessons Learned](#lessons-learned)
12. [Files Created During Session](#files-created-during-session)
13. [Files Modified During Session](#files-modified-during-session)

---

## Session Timeline

| Time       | Event                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Day 1 AM   | Initial bug fixes: `accounts/page.tsx` optional chaining, BigInt serialization                      |
| Day 1 PM   | Investigation of 14 admin issues → `ADMIN_INVESTIGATION_REPORT.md`                                  |
| Day 1 PM   | P0 Token refresh: stored 3 cookies, proxy interceptor, layout refresh                               |
| Day 1 PM   | P1 Analytics dead link replaced, P2 Native modals replaced (23→0)                                   |
| Day 1 PM   | P2 TeamMemberRow tests recreated (13 security tests)                                                |
| Day 1 PM   | P3 System Health edge case, Grandfathering test data                                                |
| Day 1 PM   | Bundle CRUD endpoints + UI, Change Plan dialog + subscription handler fix                           |
| Day 1 PM   | Account improvements: Edit Plan button, grandfathering adjust, trial display                        |
| Day 1 EVE  | ChangePlanDialog investigation → root cause: missing `tw-animate-css` + dead CSS selectors          |
| Day 1 EVE  | Dialog fix: `[role="dialog"][data-state]` selector, AdminToaster with `style` prop                  |
| Day 1 EVE  | ChangePlanDialog redesign: tabs with icons, provider cards, price preview                           |
| Day 1 EVE  | Toast + refresh fix: `refetchQueries`, Toaster inside ThemeProvider                                 |
| Day 1 LATE | Toast position (top-center), dialog animation (fade+zoom, no slide), accounts query invalidation    |
| Day 2 AM   | UI Audit: 47 issues found and fixed across 16 files                                                 |
| Day 2 AM   | Code Quality Audit: 46 issues found and fixed, REACT_STANDARDS.md created                           |
| Day 2 PM   | Group 1: Trial fix, Pricing tier CRUD, AdminUser CRUD, Security RBAC/MFA, Spacing, Audit log filter |
| Day 2 PM   | Group 2: 10 test client seed data, Help page, i18n setup                                            |
| Day 2 PM   | PostgreSQL dual-instance conflict discovered and resolved                                           |
| Day 2 PM   | i18n migration to next-intl 4.9.0 (cookie-based, no [locale]/ routing)                              |
| Day 2 EVE  | **INCIDENT:** Worktree files blindly copied, destroying 26 files                                    |
| Day 2 EVE  | Recovery: git checkout + full re-application of all session work                                    |

---

## Investigation Phase

### 14-Issue Admin Investigation

Read every page, component, and API endpoint. Tested each with curl. Produced `docs/development/ADMIN_INVESTIGATION_REPORT.md`.

**Key findings:**

| #   | Issue                    | Data Source   | Root Cause                              |
| --- | ------------------------ | ------------- | --------------------------------------- |
| 1   | Token expiry (15 min)    | JWT config    | No refresh logic in frontend            |
| 2   | PUT /settings 404        | Route existed | API not restarted after code change     |
| 3   | Grandfathering           | DB + API      | Already working correctly               |
| 4   | View Usage empty         | DB            | Empty state, not a bug                  |
| 5   | Subscriptions CRUD       | DB            | "Change Plan" intentionally disabled    |
| 6   | Pricing bundle CRUD      | DB            | Only edit existed, no create/delete     |
| 7   | RBAC/MFA                 | DB            | Working, uses native prompts (cosmetic) |
| 8   | Audit logs wrong status  | DB            | Misdiagnosis caused by broken route #2  |
| 9   | Webhooks failed fetch    | DB            | Caused by #1 (token expiry)             |
| 10  | Compliance               | DB            | Real data, config buttons "coming soon" |
| 11  | System Health "Critical" | API           | 0 events → 0% success rate → "Critical" |
| 12  | Analytics 404            | —             | Link exists, page does not              |
| 13  | Native modals            | —             | 23 alert/confirm/prompt calls           |
| 14  | TeamMemberRow tests      | —             | 13 tests deleted in Layer 3 cleanup     |

**Conclusion:** 14/14 use real data (nothing hardcoded). 6 real bugs, 8 non-issues.

---

## Bug Fixes Phase

### P0 — Token Refresh (blocked everything)

**Root cause:** Access token expires in 15 min. Cookie lives 24h. `refreshToken` and `csrfToken` from login response were discarded — never stored client-side.

**Fix (4 files):**

1. `apps/admin/app/actions/auth.ts` — Store 3 cookies on login: `admin-session` (access token), `admin-refresh` (refresh token, 7d), `admin-csrf` (CSRF token, 7d). Delete all 3 on logout.

2. `apps/admin/app/api/backend/[...path]/route.ts` — Proxy now intercepts 401 `TOKEN_EXPIRED` responses. Reads refresh/csrf cookies, calls `POST /admin/auth/refresh`, retries original request with new token. Body cached before first attempt to support retry on POST/PUT.

3. `apps/admin/app/api/auth/refresh/route.ts` (NEW) — Server-side refresh route for page-load token renewal. Layout redirects here instead of clear-session.

4. `apps/admin/app/api/clear-session/route.ts` — Deletes all 3 cookies.

### P1 — Analytics Dead Link

Replaced `href: "/analytics"` (404) with `href: "/webhooks"` in dashboard Quick Actions.

### P2a — Native Browser Modals → UI Components

Created 2 shared components:

- `apps/admin/components/ui/ConfirmDialog.tsx` — AlertDialog from @packages/ui
- `apps/admin/components/ui/InputDialog.tsx` — Dialog with text input

Replaced **23 calls** (17 alert, 4 confirm, 2 prompt) across 4 files:

- `accounts/page.tsx` — 3 alert → toast
- `subscriptions/page.tsx` — 4 confirm → ConfirmDialog, 12 alert → toast
- `RbacManager.tsx` — 2 alert → toast, 1 prompt → InputDialog
- `MfaManager.tsx` — 2 alert → toast, 1 prompt → InputDialog

### P2b — TeamMemberRow Security Tests

Recreated `apps/client/components/team/TeamMemberRow.test.tsx` with 13 tests covering OWNER/MANAGER/MEMBER/VIEWER role-based visibility.

### P3 — System Health Edge Case

`webhooks/page.tsx`: `getHealthLabel()` and `getHealthBadgeVariant()` now accept `totalEvents` parameter. Returns "No Data" (neutral badge) when `totalEvents === 0` instead of "Critical".

### Grandfathering Verification

Created test data in DB:

- `AccountSubscription` with `GRANDFATHERED` status, `pricePerMonth: 25.00`
- `SubscriptionPriceHistory` with `previousPrice: 25, newPrice: 35, effectiveAt: +60 days`

Verified: `GET /admin/accounts/:id/billing` returns `isGrandfathered: true` with correct locked/current prices.

---

## Feature Development Phase

### Bundle CRUD (POST + DELETE)

`apps/api/src/admin/pricingRoutes.ts`:

- `POST /admin/pricing/bundles` — create with slug uniqueness check
- `DELETE /admin/pricing/bundles/:id` — delete with active subscription safety check

Frontend: Create dialog + delete button in pricing page.

### Change Plan Dialog + Subscription Handler Fix

**Backend:** `apps/api/src/billing/handlers/SubscriptionAccountHandler.ts` — Replaced deprecated `subscriptionService.updateSubscription()` (always returned `err("INVALID_TIER")`) with `ChangeAccountSubscriptionUseCase` resolved from DI.

**Frontend:** `apps/admin/components/subscriptions/ChangePlanDialog.tsx` — Two-tab dialog (Custom providers + Bundle selection) with live price preview.

### Account Improvements

- `AccountBillingPanel.tsx` — "Edit Plan" button opens ChangePlanDialog. Grandfathering "Adjust" button with date input. Trial days display (only when isOnTrial). Last Login field.
- `PATCH /admin/accounts/:accountId/grandfathering` — new endpoint to adjust grandfathering expiry.
- Billing endpoint extended with trial info when `isOnTrial && trialEndDate`.

### Pricing Tier CRUD

`apps/api/src/admin/pricingRoutes.ts`:

- `POST /admin/pricing/provider-tiers` — create provider tier
- `POST /admin/pricing/account-tiers` — create account tier
- `PATCH /admin/pricing/provider-tiers/:id/status` — toggle active/inactive
- `PATCH /admin/pricing/account-tiers/:id/status` — toggle active/inactive

Frontend: "New Tier" dialogs, clickable status badge per row.

### AdminUser CRUD

`apps/api/src/admin/adminUserRoutes.ts` (NEW, 472 lines):

- `GET /admin/users` — list all
- `POST /admin/users` — create (argon2 password hash, cannot create SUPER_ADMIN)
- `GET /admin/users/:id` — detail with session count
- `PUT /admin/users/:id` — update (SUPER_ADMIN required for role changes)
- `POST /admin/users/:id/deactivate` — soft-delete (cannot deactivate last SUPER_ADMIN)
- `POST /admin/users/:id/activate` — reactivate

Frontend: `apps/admin/app/(dashboard)/users/page.tsx` — Full page with StatCards, DataTable, Invite User dialog. Sidebar link added.

### Help & Documentation Page

`apps/admin/app/(dashboard)/help/page.tsx` (447 lines) — 9 expandable accordion sections covering every admin feature. Sidebar link with HelpCircle icon.

### Seed Data — 10 Test Clients

Extended `infra/prisma/seed.ts` with `seedTestAccounts()`:

- 11 total accounts (1 Demo + 10 test)
- Status distribution: ACTIVE (6), TRIALING (2), GRANDFATHERED (2), CANCELED (1)
- Each with Project, AccountSubscription, Channels
- Variety of providers, prices, timezones, locales

---

## UI Audit & Polish Phase

`react-frontend-specialist` agent audited all 10 dashboard pages, 15+ components, and 3 root pages. Found **47 issues**.

### Issues by severity:

| Severity | Count | Key Issues                                                                                |
| -------- | ----- | ----------------------------------------------------------------------------------------- |
| CRITICAL | 5     | Hardcoded colors in error.tsx, loading.tsx, not-found.tsx, ConfirmDialog, ProjectProvider |
| HIGH     | 8     | Missing PageHeader in security sub-pages, raw buttons in RbacManager/MfaManager           |
| MEDIUM   | 22    | Custom spinners in webhook components, emoji indicators, shadow-sm, Badge inconsistency   |
| LOW      | 12    | Minor spacing, empty state icons                                                          |

All 47 fixed. Result: 0 hardcoded Tailwind colors, 100% PageHeader adoption, 0 emoji indicators, 0 custom spinners.

---

## Code Quality Audit Phase

`react-frontend-specialist` audited React patterns, TypeScript, data fetching, state management, error handling, performance, code organization, and accessibility. Found **46 issues**.

### Issues by category:

| Category               | Count | Key Issues                                                  |
| ---------------------- | ----- | ----------------------------------------------------------- |
| TypeScript             | 4     | 2 `any` types, 1 non-null assertion, loose mutation types   |
| Component Architecture | 6     | accounts/page.tsx at 910 lines, pricing at 800              |
| Data Fetching          | 8     | 6 components using useState+fetch instead of TanStack Query |
| State Management       | 4     | Server data in useState, HTMLSelectElement in state         |
| Error Handling         | 6     | 6 silent catch blocks, raw error.message exposure           |
| Performance            | 7     | No React.memo, inline object literals, duplicate useEffects |
| Code Organization      | 5     | No query key factory, duplicate utilities                   |
| Accessibility          | 6     | Icon-only buttons without aria-label, misused `<label>`     |

### Key outcomes:

- Created `apps/admin/hooks/api/queryKeys.ts` — centralized query key factory
- Created 5 new TanStack Query hook files replacing manual fetch patterns
- Created `docs/frontend/REACT_STANDARDS.md` — definitive React standards for both admin and client apps

---

## Internationalization Phase

### Approach

Used next-intl 4.9.0 (officially supports Next.js 16) with **cookie-based locale detection** (no `[locale]/` URL routing). This avoids restructuring all routes.

**How it works:**

1. First visit: next-intl reads `Accept-Language` header
2. User clicks EN/ES in sidebar: sets `NEXT_LOCALE` cookie + page reload
3. Subsequent visits: cookie has priority over browser header
4. Server renders with correct locale via `getLocale()`/`getMessages()`

### Files:

- `apps/admin/i18n/request.ts` — Reads `NEXT_LOCALE` cookie, falls back to `en`
- `apps/admin/next.config.mjs` — `createNextIntlPlugin` wrapper
- `apps/admin/messages/en.json` — 528 English keys across 15 namespaces
- `apps/admin/messages/es.json` — 528 Spanish keys
- `apps/admin/app/layout.tsx` — `NextIntlClientProvider` with server-side messages

### Translation scope:

- Sidebar navigation labels
- Page titles (PageHeader)
- Common actions (Save, Cancel, Edit, Delete, etc.)
- Status badges
- Table headers
- Dialog titles and descriptions

---

## Critical Incident: Data Loss & Recovery

### What Happened

During the i18n translation phase, I launched a `react-frontend-specialist` agent with `isolation: "worktree"` to translate all 28 files. The agent worked in an isolated git worktree (`.claude/worktrees/agent-adc64dbc/`) and **rewrote pages from scratch** with translations — losing the design system, UI audit fixes, and all previous work.

When the agent finished, I ran this command to copy its results:

```bash
cd "$WORKTREE" && git diff --name-only HEAD | while read f; do
  cp "$WORKTREE/$f" "/home/edward/projects/omni-post/$f"
done
```

This blindly copied ALL 28 modified files from the worktree to the main repo, **overwriting the working versions with simplified rewrites**.

### Damage Assessment

**26 files IN GIT** were overwritten with versions that:

- Lost all CSS variable tokens (reverted to `bg-gray-*`, `text-gray-*`, etc.)
- Lost PageHeader, StatCard, ActionButton, Badge component usage
- Lost UI audit fixes, code quality improvements, accessibility fixes
- Lost token refresh logic in layout
- Lost ThemeProvider, GeistSans font, AdminToaster from root layout

**30 files NEW (untracked)** were safe — hooks, UI components, providers, configs, message files, new pages were not affected.

### Root Cause

**My error, not the agent's.** The agent did exactly what was asked — translate files. The mistake was copying ALL worktree files blindly instead of only the new message files (`en.json`, `es.json`).

### Recovery

1. Backed up good files (message files with 528 keys) to `/tmp/`
2. Restored 26 damaged files from git commit `e30ffb2` (March 31 state)
3. Launched `react-frontend-specialist` agent **directly on the repo** (no worktree) to re-apply ALL session work in one comprehensive pass
4. Verified: 0 hardcoded colors, all pages use PageHeader, build passes

### Lesson Learned

**Never copy ALL files from an agent worktree blindly.** When an agent works in `isolation: "worktree"`:

- Only copy NEW files (untracked) that the agent created
- For MODIFIED files, the agent should work directly on the main repo
- Or: review each modified file before copying to verify it preserves existing work

Saved as feedback memory for future sessions.

---

## Infrastructure Issues Resolved

### Dual PostgreSQL Conflict

**Discovery:** `docker exec psql` showed 0 accounts but `psql` from host showed 11.

**Root cause:** Windows had PostgreSQL 16.10 installed natively on port 5432. Docker mapped the same port. The host `psql` client connected to the native instance (where Prisma wrote data), while `docker exec psql` connected to the container instance (empty).

**Resolution:** User uninstalled native PostgreSQL from Windows. After reboot, both connections point to the same Docker instance.

### Prisma .env Confusion

**Problem:** Two `.env` files existed:

- `/home/edward/projects/omni-post/.env` (root) — with `?schema=public`
- `/home/edward/projects/omni-post/infra/prisma/.env` (local) — without `?schema=public`

`prisma.config.ts` used `import "dotenv/config"` which loaded the nearest `.env`.

**Resolution:** Deleted `infra/prisma/.env`. Updated `prisma.config.ts` and `seed.ts` to explicitly load from project root:

```typescript
dotenv.config({ path: path.join(__dirname, "../../.env") });
```

### Database Schema Recreation

After Docker restart, the database was empty (0 tables). `prisma db push` said "in sync" but didn't create tables. `prisma migrate deploy` failed with P3005.

**Resolution:** Applied all 36 migration SQL files directly via `psql`:

```bash
for dir in $(ls -d infra/prisma/migrations/2025* infra/prisma/migrations/2026*); do
  docker exec -i omnipost-postgres psql -U postgres -d omnipostdb < "$dir/migration.sql"
done
```

### ChangePlanDialog Invisible

**Symptom:** Dialog opened but content invisible, UI frozen.

**Root cause (multi-layered):**

1. `apps/admin/app/globals.css` was missing `@import "tw-animate-css"` — animation utilities (`animate-in`, `fade-in-0`, `zoom-in-95`) not generated
2. Tailwind v4 `@source` scanner cannot resolve classes from pnpm workspace-linked `@packages/ui` package — `bg-black/80`, `left-[50%]`, `top-[50%]`, `z-[100]` not generated
3. CSS selectors `[data-radix-dialog-content]` were dead — Radix UI v1.4.3 no longer emits those data attributes (removed since v1.0.x)

**Resolution:**

- Added `@import "tw-animate-css"` and `@custom-variant dark`
- Created `apps/admin/lib/ui-safelist.ts` — file containing all Dialog/AlertDialog/Toast class strings for the Tailwind scanner
- Changed CSS selectors to `[role="dialog"][data-state]` (Radix v1.4.3 emits these)
- Created `AdminToaster` component with `style` prop for positioning (bypasses Tailwind scanner)
- Added `@source inline(...)` as additional safeguard

### Toast Auto-Dismiss

`TOAST_REMOVE_DELAY` was 1,000,000ms (~16 min). Added `TOAST_AUTO_DISMISS_DELAY = 5000` with `setTimeout(dismiss, ...)` in the `toast()` function.

---

## Final State

### Build

```
Tasks: 9 successful, 9 total
TypeScript errors: 0
```

### Database

```
Tables: 98
Accounts: 11 (1 Demo + 10 test)
Subscriptions: ACTIVE(6), TRIALING(2), GRANDFATHERED(2), CANCELED(1)
AdminUser: 1 (SUPER_ADMIN)
Pricing Tiers: 3 provider + 3 account
Bundles: 3 (Starter, Growth, Agency Full)
```

### Admin Portal Features

| Feature                                           | Status  |
| ------------------------------------------------- | ------- |
| Token refresh (proxy interceptor)                 | Working |
| Account CRUD + billing panel                      | Working |
| Subscription management + Change Plan             | Working |
| Pricing tier CRUD (create/edit/toggle)            | Working |
| Bundle CRUD (create/edit/delete)                  | Working |
| AdminUser CRUD (6 endpoints + UI page)            | Working |
| Grandfathering display + adjust                   | Working |
| Security RBAC (role editing)                      | Working |
| Security MFA (self-service setup)                 | Working |
| Audit log date filter                             | Working |
| Help & Documentation page                         | Working |
| i18n EN/ES (next-intl, cookie-based)              | Working |
| Toast notifications (top-center, 5s auto-dismiss) | Working |
| Dialog animations (fade+zoom from center)         | Working |

### Code Quality

```
Hardcoded Tailwind colors: 0
PageHeader adoption: 11/11 pages
Native browser dialogs: 0
any types: 0
Files over 800 lines: 0
Translation keys: 528 (EN + ES)
```

---

## Lessons Learned

1. **Never copy ALL worktree files blindly.** Only copy NEW files. For modified files, work directly on the main repo or review each file before copying.

2. **Use `react-frontend-specialist` agent early for UI/CSS debugging.** It identified Radix v1.4.3 selector changes in minutes — something I spent hours guessing about.

3. **Tailwind v4 + pnpm workspaces = broken `@source` scanning.** Workaround: `@source inline(...)` or a safelist `.ts` file with all classes as strings.

4. **Radix UI v1.4.3 dropped `data-radix-*` attributes.** Use `[role="dialog"][data-state]` instead.

5. **next-intl works without `[locale]/` routing.** Cookie-based locale detection (`NEXT_LOCALE`) avoids restructuring all routes.

6. **Always commit before large operations.** The lack of intermediate commits made recovery much harder.

7. **Dual PostgreSQL instances are silent killers.** `docker exec psql` and host `psql` can connect to different servers on the same port.

8. **`prisma db push` "in sync" can lie.** When migrations are corrupted, apply SQL directly via `psql`.

---

## Files Created During Session

### API Backend

- `apps/api/src/admin/adminUserRoutes.ts` — AdminUser CRUD (472 lines)
- `apps/api/src/admin/pricingRoutes.ts` — Extended with 4 new tier endpoints

### Admin Frontend — Components

- `apps/admin/components/ui/ActionButton.tsx`
- `apps/admin/components/ui/AdminToaster.tsx`
- `apps/admin/components/ui/Badge.tsx`
- `apps/admin/components/ui/ConfirmDialog.tsx`
- `apps/admin/components/ui/DataTable.tsx`
- `apps/admin/components/ui/InputDialog.tsx`
- `apps/admin/components/ui/PageHeader.tsx`
- `apps/admin/components/ui/StatCard.tsx`
- `apps/admin/components/ui/TabNav.tsx`
- `apps/admin/components/accounts/AccountBillingPanel.tsx`
- `apps/admin/components/subscriptions/ChangePlanDialog.tsx`
- `apps/admin/components/pricing/ProviderTiersTab.tsx`
- `apps/admin/components/pricing/AccountTiersTab.tsx`
- `apps/admin/components/security/MfaSelfService.tsx`

### Admin Frontend — Hooks

- `apps/admin/hooks/api/queryKeys.ts`
- `apps/admin/hooks/api/useAccountBilling.ts`
- `apps/admin/hooks/api/useAdminUsers.ts`
- `apps/admin/hooks/api/useBillingStats.ts`
- `apps/admin/hooks/api/useDeadLetterQueue.ts`
- `apps/admin/hooks/api/useMfaUsers.ts`
- `apps/admin/hooks/api/usePricingTiers.ts`
- `apps/admin/hooks/api/useRbacData.ts`
- `apps/admin/hooks/api/useSubscriptionMutations.ts`
- `apps/admin/hooks/api/useWebhookEvents.ts`
- `apps/admin/hooks/api/useWebhookSubscriptions.ts`

### Admin Frontend — Pages

- `apps/admin/app/(dashboard)/help/page.tsx`
- `apps/admin/app/(dashboard)/users/page.tsx`
- `apps/admin/app/api/auth/refresh/route.ts`
- `apps/admin/app/api/clear-session/route.ts`

### Admin Frontend — Config & Infra

- `apps/admin/i18n/request.ts`
- `apps/admin/lib/ui-safelist.ts`
- `apps/admin/messages/en.json` (528 keys)
- `apps/admin/messages/es.json` (528 keys)
- `apps/admin/providers/QueryProvider.tsx`
- `apps/admin/providers/ThemeProvider.tsx`
- `apps/admin/app/globals.css` (design tokens + @theme inline + @source safelist)
- `apps/admin/postcss.config.mjs`

### Client

- `apps/client/components/team/TeamMemberRow.test.tsx` (13 tests)

### Documentation

- `docs/development/ADMIN_INVESTIGATION_REPORT.md`
- `docs/development/ADMIN_FIX_REPORT.md`
- `docs/development/ADMIN_REMAINING_FIX_REPORT.md`
- `docs/development/ACCOUNT_IMPROVEMENTS_REPORT.md`
- `docs/development/CHANGEPLAN_DIALOG_INVESTIGATION.md`
- `docs/development/ADMIN_UI_AUDIT_REPORT.md`
- `docs/development/ADMIN_CODE_QUALITY_REPORT.md`
- `docs/development/ADMIN_GROUP1_REPORT.md`
- `docs/development/ADMIN_GROUP2_REPORT.md`
- `docs/development/ADMIN_BUGS_I18N_REPORT.md`
- `docs/development/ADMIN_SESSION_FULL_REPORT.md`
- `docs/frontend/REACT_STANDARDS.md`

---

## Files Modified During Session

### API Backend (kept intact through incident)

- `apps/api/src/admin/accountLifecycleRoutes.ts` — PATCH grandfathering + trial in billing response
- `apps/api/src/admin/executiveRoutes.ts` — PUT /settings route + ExecutiveAccountHandler
- `apps/api/src/admin/ExecutiveAccountHandlers.ts` — BigInt fix (select clause)
- `apps/api/src/admin/dashboardService.ts` — isActive in account summary
- `apps/api/src/billing/handlers/SubscriptionAccountHandler.ts` — ChangeAccountSubscriptionUseCase
- `apps/api/src/billing/subscriptionRoutes.ts` — Pass use case to handler
- `apps/api/src/index.ts` — Register adminUserRoutes
- `infra/prisma/seed.ts` — seedTestAccounts() + dotenv fix + isOnTrial fix
- `infra/prisma/prisma.config.ts` — dotenv path fix
- `packages/ui/src/components/use-toast.ts` — TOAST_AUTO_DISMISS_DELAY

### Admin Frontend (restored + re-applied)

- `apps/admin/app/layout.tsx` — NextIntlClientProvider + ThemeProvider + GeistSans + AdminToaster
- `apps/admin/app/(dashboard)/layout.tsx` — QueryProvider + SidebarNav + token verification
- `apps/admin/app/error.tsx` — CSS vars + ActionButton
- `apps/admin/app/not-found.tsx` — CSS vars
- `apps/admin/app/(dashboard)/page.tsx` — PageHeader + StatCard + CSS vars + useTranslations
- `apps/admin/app/(dashboard)/accounts/page.tsx` — Full redesign with design system
- `apps/admin/app/(dashboard)/subscriptions/page.tsx` — PageHeader + TabNav + useTranslations
- `apps/admin/app/(dashboard)/pricing/page.tsx` — PageHeader + extracted tabs
- `apps/admin/app/(dashboard)/executive/page.tsx` — PageHeader + StatCard + CSS vars
- `apps/admin/app/(dashboard)/security/page.tsx` — PageHeader + StatCard + CSS vars
- `apps/admin/app/(dashboard)/security/rbac/page.tsx` — PageHeader
- `apps/admin/app/(dashboard)/security/mfa/page.tsx` — PageHeader
- `apps/admin/app/(dashboard)/compliance/page.tsx` — PageHeader + TabNav + CSS vars
- `apps/admin/app/(dashboard)/webhooks/page.tsx` — PageHeader + LoadingSpinner + CSS vars
- `apps/admin/components/shared/SidebarNav.tsx` — useTranslations + locale switcher + Help/Users links
- `apps/admin/components/shared/LoadingSpinner.tsx` — CSS vars
- `apps/admin/components/auth/login-form.tsx` — CSS vars
- `apps/admin/components/security/RbacManager.tsx` — ActionButton + CSS vars + toast
- `apps/admin/components/security/MfaManager.tsx` — ActionButton + CSS vars + toast
- `apps/admin/components/settings/UsageMetricsPanel.tsx` — CSS vars
- `apps/admin/components/webhooks/WebhookMetrics.tsx` — CSS vars
- `apps/admin/components/webhooks/WebhookEventsList.tsx` — LoadingSpinner + CSS vars
- `apps/admin/components/webhooks/WebhookSubscriptions.tsx` — LoadingSpinner + CSS vars
- `apps/admin/components/webhooks/WebhookTimeline.tsx` — CSS vars
- `apps/admin/components/webhooks/DeadLetterQueue.tsx` — LoadingSpinner + CSS vars
- `apps/admin/next.config.mjs` — createNextIntlPlugin
- `apps/admin/package.json` — next-intl, tw-animate-css dependencies
