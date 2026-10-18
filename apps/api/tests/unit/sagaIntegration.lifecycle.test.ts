/**
 * SagaIntegration — Lifecycle Tests
 *
 * Validates:
 * - Domain event emission when a saga is started (Event Handling)
 * - Graceful shutdown: active-instance counter reaches zero, and a running
 *   saga is handed off to Redis as PENDING with its scheduled retry kept
 * - Error handling: validation failures and unexpected errors are
 *   surfaced correctly from route handlers
 *
 * @file sagaIntegration.lifecycle.test.ts
 * @description Tests for SagaIntegration - Event Handling
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { until } from "@packages/vitest-shared/determinism";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import { logger } from "../../src/lib/logger.js";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  TEST_ACCOUNT_ID,
  type MockEventService,
  type MockPrisma,
  type MockRedis,
} from "./sagaIntegration.helpers.js";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

/** The statuses a saga never leaves. */
const TERMINAL_STATUSES: readonly unknown[] = ["COMPLETED", "FAILED", "COMPENSATED"];

/** The fields of a saga's hot-cache record these tests read. */
interface SagaRecord {
  status: string;
  nextRetryAt?: string;
}

/** The columns of a saga's durable row these tests read. */
interface SagaRow {
  status: string;
  accountId: string | null;
  nextRetryAt: Date | null;
}

/**
 * The saga's durable row as the Prisma double holds it, reached through a documented cast: the
 * harness builds the double inside `buildIntegration` and hands back no reference, and the
 * integration keeps its configuration private.
 */
async function durableRow(integration: SagaIntegration, sagaId: string): Promise<SagaRow | null> {
  const prisma = (integration as unknown as { config: { prisma: MockPrisma } }).config.prisma;
  return (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as SagaRow | null;
}

/**
 * Waits until the pass each started saga's start deferred has parked it, a retry scheduled or an
 * ending reached, as the hot cache records it. Shutting down under a running pass leaves it
 * advancing against a stopped manager after the test ended, so no pass may outlive its test.
 */
async function awaitEverySagaParked(redis: MockRedis): Promise<void> {
  await until(
    async () => {
      const keys = await redis.keys("saga:*");
      const cached = await Promise.all(keys.map((key) => redis.get(key)));
      return cached.every((entry) => {
        if (entry === null) return false;
        const record = JSON.parse(entry) as { status?: unknown; nextRetryAt?: unknown };
        return record.nextRetryAt !== undefined || TERMINAL_STATUSES.includes(record.status);
      });
    },
    { description: "every started saga's first pass to park it", timeoutMs: 3_000, intervalMs: 5 }
  );
}

// ============================================================================
// Event Handling Tests
// ============================================================================

describe("SagaIntegration - Event Handling", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockEventService: MockEventService;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockEventService, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    await awaitEverySagaParked(mockRedis);
    await integration.shutdown();
  });

  it("should emit saga started event when starting saga", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    await handler(makeStartRequest(), passthroughReply);

    // The start appends the event in the transaction it commits before the handler returns.
    const startedEvents = mockEventService.publishedEvents.filter((e) => e.type === "saga.started");
    expect(startedEvents.length > 0).toBeTruthy();
  });
});

// ============================================================================
// Graceful Shutdown Tests
// ============================================================================

describe("SagaIntegration - Graceful Shutdown", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockRedis } = await buildIntegration());
  });

  // afterEach is intentionally present here: shutdown() is called explicitly
  // inside some tests, but we still need to clean up if a test exits early.
  afterEach(async () => {
    try {
      await integration.shutdown();
    } catch {
      // Already shut down — ignore.
    }
  });

  it("should shutdown gracefully", async () => {
    await integration.shutdown();

    const manager = integration.getSagaManager();
    const metrics = manager.getMetrics();

    expect(metrics.activeInstances).toBe(0);
  });

  it("should persist running sagas during shutdown", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    const result = await handler(makeStartRequest(), passthroughReply);

    // The start's pass leaves the saga RUNNING, parked on a scheduled retry: the state a shutdown
    // has to hand off. Shutting down before that pass ran would find the saga still PENDING, hand
    // off nothing, and leave the pass to run against the stopped manager.
    await awaitEverySagaParked(mockRedis);
    const parked = JSON.parse((await mockRedis.get(`saga:${result.data.sagaId}`))!) as SagaRecord;
    expect(parked.status).toBe("RUNNING");
    expect((await durableRow(integration, result.data.sagaId))?.status).toBe("RUNNING");

    await integration.shutdown();

    // The drain hands the saga off as PENDING and keeps its retry. The next process's retry scan
    // selects it by the DURABLE row, so the hand-off must land there under the owning account; the
    // cache is a best-effort copy written only after that row commits.
    const row = await durableRow(integration, result.data.sagaId);
    expect(row).toMatchObject({ status: "PENDING", accountId: TEST_ACCOUNT_ID });
    expect(row?.nextRetryAt?.toISOString()).toBe(parked.nextRetryAt);

    const data = await mockRedis.get(`saga:${result.data.sagaId}`);
    expect(data).toBeTruthy();
    const handedOff = JSON.parse(data!) as SagaRecord;
    expect(handedOff.status).toBe("PENDING");
    expect(handedOff.nextRetryAt).toBe(parked.nextRetryAt);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("SagaIntegration - Error Handling", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    ({ integration, routes, mockRedis } = await buildIntegration());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await awaitEverySagaParked(mockRedis);
    await integration.shutdown();
  });

  it("should handle validation errors for invalid post data", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    // Empty body — fails Zod schema (body required for mode=draft)
    const request = makeStartRequest({ mode: "draft" });
    request.body = {
      mode: "draft",
      projectId: request.body.projectId,
      // No body / locale — schema requires them for draft
    };

    await expect(handler(request, passthroughReply)).rejects.toThrow();
  });

  it("should handle errors when saga manager fails", async () => {
    const handler = routes.get("POST:/sagas/post-publishing/start");
    const failure = new Error("the saga store is unavailable");
    vi.spyOn(integration.getSagaManager(), "startSaga").mockRejectedValue(failure);
    const logged = vi.spyOn(logger, "error").mockImplementation(() => logger);

    // An unexpected failure surfaces as an internal error that chains the original, and is logged
    // with it, so the error tracker keeps the actionable class.
    await expect(
      handler(makeStartRequest({ body: "Test" }), passthroughReply)
    ).rejects.toMatchObject({ statusCode: 500, message: "Failed to start saga", cause: failure });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      "Failed to start post publishing saga"
    );
  });
});
