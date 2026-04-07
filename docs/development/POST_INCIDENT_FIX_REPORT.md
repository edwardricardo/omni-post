# Post-Incident Fix Report

**Date:** 2026-04-06

---

## Fixes Applied

| Fix                    | File                     | Change                                                                                                            | Verified                                         |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Remove ProjectProvider | `(dashboard)/layout.tsx` | Removed import + wrapper                                                                                          | 0 refs                                           |
| Remove inbox/unread    | `SidebarNav.tsx`         | Removed fetch, useQuery, badge logic                                                                              | 0 refs                                           |
| useExecutive hook      | `useExecutive.ts`        | No change needed — data is valid platform metrics                                                                 | API confirmed                                    |
| Webhook design system  | 5 `webhooks/*.tsx` files | Card→div, Button→ActionButton, Badge→admin Badge, Table→native, Input→native, Select→native, Switch→toggle button | Only Dialog/AlertDialog remain from @packages/ui |
| UsageMetricsPanel      | `UsageMetricsPanel.tsx`  | "AI Calls"→"AI Calls Used", "Storage"→"Storage Used"                                                              | Labels clarified                                 |

---

## Details

### Fix 1 — ProjectProvider Removed

`apps/admin/app/(dashboard)/layout.tsx`:

- Removed `import { ProjectProvider } from "@/providers/ProjectProvider"`
- Replaced `<ProjectProvider>{children}</ProjectProvider>` with `{children}`
- **Impact:** Eliminates "No projects found" error — admin has no project context

### Fix 2 — Inbox/Unread Removed

`apps/admin/components/shared/SidebarNav.tsx`:

- Removed `useQuery` import from `@tanstack/react-query`
- Removed `fetchInboxUnread` async function (called `/api/backend/inbox/unread-count`)
- Removed `useQuery` block with `queryKey: ["inbox", "unread-count"]`
- Removed `enrichedGroup` logic that injected badge count into non-existent "Social" nav group
- Nav items now render directly from `NAV_GROUPS`

### Fix 3 — useExecutive (No Change)

`apps/admin/hooks/api/useExecutive.ts`:

- The API (`/api/admin/executive/metrics`) returns `projects`, `posts`, `channels` as platform-wide metrics
- These are valid for admin (total projects created, total posts published, total channels connected across all accounts)
- The hook correctly maps these to the executive dashboard
- **No change needed** — data is legitimate platform metrics, not client-app features

### Fix 4 — Webhook Components

5 files migrated from @packages/ui to admin design system:

| Component                   | @packages/ui | Admin replacement                                                                                          |
| --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| Card/CardContent/CardHeader | `Card`       | `<div>` with `bg-[var(--bg-surface)] border-[var(--border-subtle)] rounded-lg p-4`                         |
| Button                      | `Button`     | `ActionButton` from `@/components/ui/ActionButton`                                                         |
| Badge                       | `Badge`      | `Badge` from `@/components/ui/Badge` (variant mapping: default→info, secondary→neutral, destructive→error) |
| Table/TableRow/TableCell    | `Table`      | Native `<table>` with admin CSS var styling                                                                |
| Input                       | `Input`      | Native `<input>` with admin input classes                                                                  |
| Select/SelectTrigger        | `Select`     | Native `<select>` with admin styling                                                                       |
| Switch                      | `Switch`     | Button with `role="switch"` and `aria-checked`                                                             |
| Progress                    | `Progress`   | Inline `ProgressBar` component with CSS vars                                                               |
| Label                       | `Label`      | Native `<label>`                                                                                           |

**Kept from @packages/ui:** Dialog, AlertDialog (sub-components) — needed for portal behavior.

Also fixed: `Record<string, any>` → `Record<string, unknown>` in DeadLetterQueue.

### Fix 5 — UsageMetricsPanel Labels

`apps/admin/components/settings/UsageMetricsPanel.tsx`:

- "AI Calls" → "AI Calls Used"
- "Storage" → "Storage Used"
- "Posts Published" and "Team Members" already clear — unchanged
- Component already used CSS design tokens correctly

---

## Build: 0 errors, FULL TURBO
