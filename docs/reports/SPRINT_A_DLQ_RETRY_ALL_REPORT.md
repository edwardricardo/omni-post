# Sprint A — DLQ Retry-All Bug Fix Report

**Date:** 2026-04-10
**Priority:** P0
**Status:** Already Implemented — No changes required

---

## Original Issue

The audit reported that `DeadLetterQueue.tsx:138-155` calls
`POST /api/webhooks/dashboard/dead-letter/retry-all`
but the endpoint did not exist in `webhookDashboardRoutes.ts`, returning 404 at runtime.

## Investigation Results

After thorough codebase exploration, **all 3 layers are fully implemented**:

### 1. Route Registration

**File:** `apps/api/src/webhooks/webhookDashboardRoutes.ts` (lines 337–345)

```typescript
fastify.post(
  "/api/webhooks/dashboard/dead-letter/retry-all",
  {
    preHandler: [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)],
    schema: { tags: ["Webhooks"], summary: "Retry all unresolved dead letter events" },
  },
  handler.retryAllDeadLetterEvents.bind(handler)
);
```

- Route is registered **before** the parameterized `/:eventId/retry` route, preventing Fastify from matching "retry-all" as an `eventId`.
- Auth: `requireAdminAuth` + `requirePermission(Permission.WEBHOOK_MANAGE)`.

### 2. Handler

**File:** `apps/api/src/webhooks/webhookDashboardRoutes.ts` (lines 178–188)

```typescript
async retryAllDeadLetterEvents(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx: RouteContext = { request, reply };
  const userId = request.auth?.user?.id;
  if (!userId) {
    return this.sendError(ctx, 401, "Authentication required");
  }
  const result = await this.service.retryAllDeadLetterEvents(userId);
  return this.sendSuccess(ctx, result);
}
```

- Validates authentication before delegating to service.
- Passes `userId` for audit trail (`resolvedBy` field).

### 3. Service Method

**File:** `apps/api/src/webhooks/webhookDashboardService.ts` (lines 573–626)

- Queries `WebhookDeadLetter` records where `resolvedAt IS NULL`.
- Processes in **batches of 50** to avoid loading the entire table into memory.
- For each event: sets `resolvedAt = new Date()` and `resolvedBy = userId`.
- Individual try/catch per event — a single failure does not abort the batch.
- Returns `{ total: number, queued: number, failed: number }`.

### 4. Frontend

**File:** `apps/admin/components/webhooks/DeadLetterQueue.tsx` (lines 138–155)

- Calls `POST /api/backend/api/webhooks/dashboard/dead-letter/retry-all`.
- Refreshes the DLQ event list on success via `fetchDeadLetterEvents()`.
- Button conditionally rendered when `events.length > 0`.

### 5. Prisma Model

**File:** `infra/prisma/schema.prisma` (lines 1539–1563)

`WebhookDeadLetter` model includes `resolvedAt` (DateTime?) and `resolvedBy` (String?) fields used by the bulk retry operation.

---

## Observations

### Logic Duplication

The bulk `retryAllDeadLetterEvents()` does **not** reuse `retryDeadLetterEvent()`. Both methods independently perform the same Prisma update (`resolvedAt + resolvedBy`). This is functional but introduces maintenance risk — if the single-retry logic changes (e.g., adding BullMQ re-enqueue), the bulk version must be updated separately.

### Access Control Difference

| Method                                     | Scope          | Access Control                             |
| ------------------------------------------ | -------------- | ------------------------------------------ |
| `retryDeadLetterEvent(eventId, accountId)` | Single event   | Validates event belongs to `accountId`     |
| `retryAllDeadLetterEvents(userId)`         | All unresolved | No account filter — processes all accounts |

This is **correct behavior** because the bulk endpoint is admin-only with `WEBHOOK_MANAGE` permission. Admin users manage all accounts.

---

## Conclusion

The DLQ retry-all feature was implemented in a prior session. The original audit finding is no longer valid. No code changes were made.

**Future consideration:** Refactor `retryAllDeadLetterEvents()` to delegate to `retryDeadLetterEvent()` per event, eliminating the duplicated update logic.
