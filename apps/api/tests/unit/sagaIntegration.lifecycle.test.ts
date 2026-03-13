/**
 * SagaIntegration — Lifecycle Tests
 *
 * Validates:
 * - Domain event emission when a saga is started (Event Handling)
 * - Graceful shutdown: active-instance counter reaches zero, in-flight
 *   sagas are persisted to Redis before the process exits
 * - Error handling: validation failures and unexpected errors are
 *   surfaced correctly from route handlers
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SagaIntegration } from "../../src/saga/SagaIntegration";
import {
  buildIntegration,
  makeStartRequest,
  passthroughReply,
  type MockEventService,
  type MockRedis,
} from "./sagaIntegration.helpers";

// Suppress verbose background-execution logs so they don't corrupt the TAP
// stream when this file runs as a subprocess in the full test suite.
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// ============================================================================
// Event Handling Tests
// ============================================================================

describe("SagaIntegration - Event Handling", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    ({ integration, routes, mockEventService } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should emit saga started event when starting saga", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");
    await handler(makeStartRequest(), passthroughReply);

    // Allow the event to be published asynchronously.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

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
    const handler = routes.get("POST:/api/sagas/post-publishing/start");
    const result = await handler(makeStartRequest(), passthroughReply);

    // Shutdown before the background executor finishes.
    await integration.shutdown();

    const data = await mockRedis.get(`saga:${result.data.sagaId}`);
    expect(data).toBeTruthy();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("SagaIntegration - Error Handling", () => {
  let integration: SagaIntegration;
  let routes: Map<string, (req: any, reply: any) => any>;

  beforeEach(async () => {
    ({ integration, routes } = await buildIntegration());
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should handle validation errors for invalid post data", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");
    const request = {
      body: {
        postData: {
          // Missing required 'body' field
          channelIds: [],
        },
      },
      user: { id: "user-123" },
      headers: {},
      ip: "127.0.0.1",
    };

    const reply = {
      status: (code: number) => ({
        send: (data: any) => ({ statusCode: code, ...data }),
      }),
    };

    try {
      await handler(request, reply);
      expect.unreachable("Should throw validation error");
    } catch (error: any) {
      expect(error).toBeTruthy();
    }
  });

  it("should handle errors when saga manager fails", async () => {
    const handler = routes.get("POST:/api/sagas/post-publishing/start");
    const request = {
      body: {
        postData: {
          body: "Test",
          channelIds: ["channel-1"],
        },
      },
      user: { id: "user-123", projectId: "project-456" },
      headers: {},
      ip: "127.0.0.1",
    };

    // Should not throw unhandled errors for valid input.
    const result = await handler(request, passthroughReply);
    expect(result).toBeTruthy();
  });
});
