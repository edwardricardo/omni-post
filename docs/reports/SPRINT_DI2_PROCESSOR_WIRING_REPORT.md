# Sprint DI.2 — Wire GatewaySwitchProcessor to Startup Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Wire the fully implemented `GatewaySwitchProcessor` BullMQ worker to the API server startup so that gateway switch reminder (24h) and suspend (48h) jobs are actually processed.

---

## Problem

`GatewaySwitchProcessor` was created in Sprint B with correct constructor injection (`redisConnection`, `PrismaClient`, `EmailPort`) but was never instantiated during server startup. The `GatewaySwitchJobService.startCheckoutWindow()` correctly enqueues reminder and suspend jobs to the `gateway-switch` BullMQ queue, but no worker was consuming them.

---

## Fix

**File:** `apps/api/src/index.ts` (lines 573-584)

Added initialization alongside the outbox relay startup:

```typescript
const { GatewaySwitchProcessor } = await import("./billing/gatewaySwitchProcessor.js");
const switchProcessorRedis = createRedisConnection();
switchProcessorRedis.on("error", () => {});
const _gatewaySwitchProcessor = new GatewaySwitchProcessor(
  switchProcessorRedis,
  app.container!.resolve(TOKENS.PrismaClient),
  app.container!.resolve(TOKENS.EmailPort)
);
logger.info("GatewaySwitchProcessor started");
```

Pattern: dedicated Redis connection (same as outbox relay), PrismaClient and EmailPort resolved from DI container.

**Note:** `WebhookJobProcessor` is initialized inside `webhookManager.ts` (not index.ts), so the startup location follows the outbox relay pattern instead, which is the closest equivalent in index.ts.

---

## Files Modified (1)

| File                    | Change                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `apps/api/src/index.ts` | +GatewaySwitchProcessor initialization after outbox relay startup |

---

## Quality Gates

| Check                               | Result                                          |
| ----------------------------------- | ----------------------------------------------- |
| TypeScript build                    | 9/9 tasks, 0 errors                             |
| ESLint                              | 0 errors, 0 warnings                            |
| GatewaySwitchProcessor in index.ts  | 3 lines (import, new, logger.info)              |
| No `import { prisma }` in processor | Confirmed — uses `import type { PrismaClient }` |
