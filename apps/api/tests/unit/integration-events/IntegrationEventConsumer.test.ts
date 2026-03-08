/**
 * Unit Tests - IntegrationEventConsumer
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests for the consumer routing logic, handler stubs, and lifecycle.
 *
 * Strategy:
 * - No real BullMQ Worker or Redis connection is created in any test.
 * - Routing logic is tested via `consumer.processJob()` directly.
 * - Handler stub correctness is tested by calling `handle()` directly.
 * - Worker lifecycle (start/stop) is tested by inspecting `isRunning` only
 *   when the Worker creation can be avoided (i.e., we do NOT call start() in
 *   Tier-0 tests to avoid needing Redis).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IntegrationEventConsumer,
  type IntegrationEventConsumerOptions,
} from "../../../src/infrastructure/integration-events/IntegrationEventConsumer.js";
import type { IntegrationEventHandler } from "../../../src/infrastructure/integration-events/IntegrationEventHandler.js";
import type { IntegrationEvent } from "../../../src/infrastructure/integration-events/IntegrationEvent.js";
import { AnalyticsEventHandler } from "../../../src/infrastructure/integration-events/handlers/AnalyticsEventHandler.js";
import { WebhookEventHandler } from "../../../src/infrastructure/integration-events/handlers/WebhookEventHandler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ConnectionOptions — never used to create a real connection in these tests */
const FAKE_CONNECTION: IntegrationEventConsumerOptions["connection"] = {
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
};

/** Build a minimal IntegrationEvent for testing */
function makeEvent(eventType: string): IntegrationEvent {
  return {
    eventId: `evt-${eventType}-1`,
    eventType,
    aggregateId: "agg-1",
    aggregateType: "Post",
    occurredAt: "2026-02-23T12:00:00.000Z",
    schemaVersion: 1,
    payload: { postId: "agg-1" },
    metadata: {},
    source: "omnipost-api",
  };
}

/** Build a mock IntegrationEventHandler with a spy on handle() */
function makeMockHandler(eventTypes: string[]): IntegrationEventHandler & {
  handleCalls: IntegrationEvent[];
} {
  const handleCalls: IntegrationEvent[] = [];
  return {
    eventTypes,
    async handle(event: IntegrationEvent): Promise<void> {
      handleCalls.push(event);
    },
    handleCalls,
  };
}

// ---------------------------------------------------------------------------
// IntegrationEventConsumer routing tests
// ---------------------------------------------------------------------------

describe("IntegrationEventConsumer — routing", { concurrency: 1 }, () => {
  it("routes a job to the correct handler based on eventType", async () => {
    const analyticsHandler = makeMockHandler(["PostCreated", "PostPublished"]);
    const webhookHandler = makeMockHandler(["PostCancelled"]);

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [analyticsHandler, webhookHandler],
    });

    const event = makeEvent("PostCreated");
    await consumer.processJob("PostCreated", event);

    assert.equal(analyticsHandler.handleCalls.length, 1);
    assert.deepEqual(analyticsHandler.handleCalls[0], event);
    assert.equal(webhookHandler.handleCalls.length, 0);
  });

  it("routes to multiple handlers when both handle the same event type", async () => {
    const handlerA = makeMockHandler(["PostPublished"]);
    const handlerB = makeMockHandler(["PostPublished"]);

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handlerA, handlerB],
    });

    const event = makeEvent("PostPublished");
    await consumer.processJob("PostPublished", event);

    assert.equal(handlerA.handleCalls.length, 1);
    assert.equal(handlerB.handleCalls.length, 1);
    assert.deepEqual(handlerA.handleCalls[0], event);
    assert.deepEqual(handlerB.handleCalls[0], event);
  });

  it("skips silently when no handler is registered for the event type", async () => {
    const analyticsHandler = makeMockHandler(["PostCreated"]);

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [analyticsHandler],
    });

    // "PostCancelled" has no handler — must not throw, must not call analyticsHandler
    await assert.doesNotReject(() =>
      consumer.processJob("PostCancelled", makeEvent("PostCancelled"))
    );
    assert.equal(analyticsHandler.handleCalls.length, 0);
  });

  it("passes the full IntegrationEvent DTO to the handler unchanged", async () => {
    let capturedEvent: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostScheduled"],
      async handle(event) {
        capturedEvent = event;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
    });

    const event: IntegrationEvent = {
      eventId: "evt-xyz-42",
      eventType: "PostScheduled",
      aggregateId: "post-99",
      aggregateType: "Post",
      occurredAt: "2026-03-01T10:00:00.000Z",
      schemaVersion: 2,
      payload: { postId: "post-99", scheduledAt: "2026-03-01T10:00:00.000Z" },
      metadata: { correlationId: "corr-abc" },
      source: "omnipost-api",
    };

    await consumer.processJob("PostScheduled", event);

    assert.ok(capturedEvent !== undefined, "handler was not called");
    assert.deepEqual(capturedEvent, event);
  });

  it("handles an empty handlers array without throwing", async () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
    });

    await assert.doesNotReject(() => consumer.processJob("PostCreated", makeEvent("PostCreated")));
  });

  it("registeredEventTypes lists all event types with at least one handler", () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [
        makeMockHandler(["PostCreated", "PostPublished"]),
        makeMockHandler(["PostCancelled"]),
      ],
    });

    const registered = consumer.registeredEventTypes.sort();
    assert.deepEqual(registered, ["PostCancelled", "PostCreated", "PostPublished"]);
  });

  it("registeredEventTypes is empty when no handlers are registered", () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
    });

    assert.deepEqual(consumer.registeredEventTypes, []);
  });
});

// ---------------------------------------------------------------------------
// isRunning — lifecycle (no real Worker created)
// ---------------------------------------------------------------------------

describe("IntegrationEventConsumer — isRunning", { concurrency: 1 }, () => {
  it("isRunning is false before start() is called", () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
    });

    assert.equal(consumer.isRunning, false);
  });

  it("stop() on a non-running consumer is a no-op and resolves", async () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
    });

    await assert.doesNotReject(() => consumer.stop());
    assert.equal(consumer.isRunning, false);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsEventHandler
// ---------------------------------------------------------------------------

describe("AnalyticsEventHandler", { concurrency: 1 }, () => {
  it("declares the correct event types", () => {
    const handler = new AnalyticsEventHandler();
    const types = Array.from(handler.eventTypes).sort();
    assert.deepEqual(types, ["PostCreated", "PostPublishingFailed", "PostPublished"].sort());
  });

  it("handle() resolves without error for PostCreated", async () => {
    const handler = new AnalyticsEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostCreated")));
  });

  it("handle() resolves without error for PostPublished", async () => {
    const handler = new AnalyticsEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostPublished")));
  });

  it("handle() resolves without error for PostPublishingFailed", async () => {
    const handler = new AnalyticsEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostPublishingFailed")));
  });
});

// ---------------------------------------------------------------------------
// WebhookEventHandler
// ---------------------------------------------------------------------------

describe("WebhookEventHandler", { concurrency: 1 }, () => {
  it("declares the correct event types", () => {
    const handler = new WebhookEventHandler();
    const types = Array.from(handler.eventTypes).sort();
    assert.deepEqual(
      types,
      ["PostCancelled", "PostPublishingFailed", "PostPublished", "PostScheduled"].sort()
    );
  });

  it("handle() resolves without error for PostPublished", async () => {
    const handler = new WebhookEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostPublished")));
  });

  it("handle() resolves without error for PostPublishingFailed", async () => {
    const handler = new WebhookEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostPublishingFailed")));
  });

  it("handle() resolves without error for PostScheduled", async () => {
    const handler = new WebhookEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostScheduled")));
  });

  it("handle() resolves without error for PostCancelled", async () => {
    const handler = new WebhookEventHandler();
    await assert.doesNotReject(() => handler.handle(makeEvent("PostCancelled")));
  });
});

// ---------------------------------------------------------------------------
// Routing: real stub handlers wired into consumer
// ---------------------------------------------------------------------------

describe("IntegrationEventConsumer — wired with real stub handlers", { concurrency: 1 }, () => {
  it("AnalyticsEventHandler is routed PostPublished without error", async () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [new AnalyticsEventHandler()],
    });

    await assert.doesNotReject(() =>
      consumer.processJob("PostPublished", makeEvent("PostPublished"))
    );
  });

  it("WebhookEventHandler is routed PostScheduled without error", async () => {
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [new WebhookEventHandler()],
    });

    await assert.doesNotReject(() =>
      consumer.processJob("PostScheduled", makeEvent("PostScheduled"))
    );
  });

  it("both handlers receive PostPublished when both are registered", async () => {
    let analyticsCalled = false;
    let webhookCalled = false;

    const analyticsStub: IntegrationEventHandler = {
      eventTypes: ["PostPublished"],
      async handle(_event) {
        analyticsCalled = true;
      },
    };
    const webhookStub: IntegrationEventHandler = {
      eventTypes: ["PostPublished"],
      async handle(_event) {
        webhookCalled = true;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [analyticsStub, webhookStub],
    });

    await consumer.processJob("PostPublished", makeEvent("PostPublished"));

    assert.equal(analyticsCalled, true, "analytics handler was not called");
    assert.equal(webhookCalled, true, "webhook handler was not called");
  });

  it("concurrency defaults to 3 and custom value is accepted", () => {
    // We can only verify this indirectly — confirm construction succeeds for both cases
    const defaultConsumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
    });
    assert.equal(defaultConsumer.isRunning, false);

    const customConsumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [],
      concurrency: 10,
    });
    assert.equal(customConsumer.isRunning, false);
  });
});

// ---------------------------------------------------------------------------
// P2-5: Schema validation + upcasting integration
// ---------------------------------------------------------------------------

import { EventSchemaRegistry } from "../../../src/infrastructure/integration-events/EventSchemaRegistry.js";
import {
  UpcasterChain,
  type Upcaster,
} from "../../../src/infrastructure/integration-events/EventUpcaster.js";
import { z } from "zod";

describe("IntegrationEventConsumer — schema validation (P2-5)", { concurrency: 1 }, () => {
  it("passes event through to handler when payload is valid", async () => {
    const registry = new EventSchemaRegistry();
    let received: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostCreated"],
      async handle(event) {
        received = event;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      schemaRegistry: registry,
    });

    const event = makeEvent("PostCreated");
    // Provide a valid PostCreated v1 payload
    const validEvent: IntegrationEvent = {
      ...event,
      payload: {
        postId: "post-1",
        projectId: "proj-1",
        body: "Hello world",
        locale: "en",
      },
    };

    await consumer.processJob("PostCreated", validEvent);

    assert.ok(received !== undefined, "handler should have been called");
    assert.deepEqual(received, validEvent);
  });

  it("skips event and does not call handler when payload is invalid", async () => {
    const registry = new EventSchemaRegistry();
    let handlerCalled = false;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostCreated"],
      async handle(_event) {
        handlerCalled = true;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      schemaRegistry: registry,
    });

    const invalidEvent: IntegrationEvent = {
      ...makeEvent("PostCreated"),
      payload: {
        // missing required: projectId, body, locale
        postId: "post-1",
      },
    };

    // Must not throw even though payload is invalid
    await assert.doesNotReject(() => consumer.processJob("PostCreated", invalidEvent));
    assert.equal(handlerCalled, false, "handler should NOT be called for invalid payload");
  });

  it("does not validate events with type not in registry (passes through)", async () => {
    const registry = new EventSchemaRegistry();
    // UnregisteredEvent is not in the default registry
    let received: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["UnregisteredEvent"],
      async handle(event) {
        received = event;
      },
    };

    // Manually register the handler for an event type not in schema registry
    // We need to register the event type in the consumer but NOT in the registry
    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      schemaRegistry: registry,
    });

    const event: IntegrationEvent = {
      ...makeEvent("UnregisteredEvent"),
      payload: { anything: "goes" },
    };

    await consumer.processJob("UnregisteredEvent", event);

    assert.ok(received !== undefined, "handler should be called for unregistered event types");
  });

  it("consumer without registry or upcaster works (backwards compat)", async () => {
    // No schemaRegistry, no upcasterChain — original behavior
    let received: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostCreated"],
      async handle(event) {
        received = event;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      // No schemaRegistry or upcasterChain
    });

    const event = makeEvent("PostCreated");
    await consumer.processJob("PostCreated", event);

    assert.ok(received !== undefined, "handler should be called without registry");
    assert.deepEqual(received, event);
  });
});

describe("IntegrationEventConsumer — upcasting (P2-5)", { concurrency: 1 }, () => {
  it("upcasts event from v1 to v2 before passing to handler", async () => {
    const registry = new EventSchemaRegistry();
    const chain = new UpcasterChain();

    // Register a v2 schema for PostCreated that requires a 'tags' field
    registry.register(
      "PostCreated",
      2,
      z.object({
        postId: z.string(),
        projectId: z.string(),
        body: z.string(),
        locale: z.string(),
        title: z.string().optional(),
        tags: z.array(z.string()),
      })
    );

    // Upcaster v1 → v2: adds empty tags array
    const upcaster: Upcaster = {
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p) => ({ ...(p as Record<string, unknown>), tags: [] }),
    };
    chain.register(upcaster);

    let received: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostCreated"],
      async handle(event) {
        received = event;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      schemaRegistry: registry,
      upcasterChain: chain,
    });

    // Send a v1 event (no tags field)
    const v1Event: IntegrationEvent = {
      ...makeEvent("PostCreated"),
      schemaVersion: 1,
      payload: {
        postId: "post-1",
        projectId: "proj-1",
        body: "Hello",
        locale: "en",
      },
    };

    await consumer.processJob("PostCreated", v1Event);

    assert.ok(received !== undefined, "handler should have been called after upcast");
    // The handler should receive the upcasted payload (with tags)
    assert.equal(received.schemaVersion, 2, "event should have been upcasted to v2");
    const payload = received.payload as Record<string, unknown>;
    assert.ok(Array.isArray(payload["tags"]), "upcasted payload should have tags array");
  });

  it("does not upcast when event is already at current version", async () => {
    const registry = new EventSchemaRegistry();
    const chain = new UpcasterChain();

    // Upcaster v1 → v2
    chain.register({
      eventType: "PostScheduled",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p) => ({ ...(p as Record<string, unknown>), newField: "added" }),
    });

    let received: IntegrationEvent | undefined;
    const handler: IntegrationEventHandler = {
      eventTypes: ["PostScheduled"],
      async handle(event) {
        received = event;
      },
    };

    const consumer = new IntegrationEventConsumer({
      connection: FAKE_CONNECTION,
      handlers: [handler],
      schemaRegistry: registry,
      upcasterChain: chain,
    });

    // Send a v1 event with current registry version = 1 (no v2 registered in schema)
    const event: IntegrationEvent = {
      ...makeEvent("PostScheduled"),
      schemaVersion: 1,
      payload: {
        postId: "post-2",
        scheduledAt: "2026-03-01T10:00:00.000Z",
        timezone: "UTC",
      },
    };

    await consumer.processJob("PostScheduled", event);

    assert.ok(received !== undefined, "handler should have been called");
    // Version stays at 1 — no v2 in schema registry
    assert.equal(received.schemaVersion, 1, "version should remain 1");
    const payload = received.payload as Record<string, unknown>;
    assert.equal(payload["newField"], undefined, "upcaster should NOT have been applied");
  });
});
