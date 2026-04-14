# OmniPost Client — Feature Backlog

## Publishing Queue Monitor

**Priority:** P1
**Effort:** M
**Origin:** Removed from client in code-first audit (2026-04-10)
**Audit reference:** CODE_FIRST_AUDIT_REPORT.md — Section 4, Finding 1

### Context

The client app had a `/dashboard/queue` page that called admin-only BullMQ queue endpoints (`/admin/queue/*`). These endpoints are protected by `requireAdminAuth` and return 401/403 for customer users. The page was non-functional for actual clients and has been removed.

### What to Build

A customer-scoped publishing queue view showing only the current user's publishing jobs.

**New API endpoint needed:**

- `GET /api/publishing/jobs` — customer-scoped, returns only jobs belonging to the authenticated customer
- Filters by project if `?projectId=` provided
- Shows: status (waiting/active/failed/completed), platform, scheduledAt, post preview, error message if failed

**Frontend:**

- Page: `/dashboard/publishing/queue`
- Jobs grouped by status
- Failed jobs show user-friendly error reason
- Optional: "Retry" button via `POST /api/publishing/jobs/:id/retry` (customer-scoped)

**Not in scope (admin only):**

- Raw BullMQ stats (active workers, queue depth)
- Remove jobs
- View other customers' jobs
