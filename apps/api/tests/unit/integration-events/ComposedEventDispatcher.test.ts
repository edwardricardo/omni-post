/**
 * Unit Tests - ComposedEventDispatcher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests for the ComposedEventDispatcher class.
 * Uses mocked InMemoryEventDispatcher and IntegrationEventPublisher — no external deps.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { ComposedEventDispatcher } from "../../../src/infrastructure/integration-events/ComposedEventDispatcher.js";
import type {
  EventDispatcher,
  DomainEvent,
  DomainEventHandler,
} from "../../../src/domain/events/DomainEvent.js";
import type { IntegrationEventPublisher } from "../../../src/infrastructure/integration-events/IntegrationEventPort.js";
import type { IntegrationEvent } from "../../../src/infrastructure/integration-events/IntegrationEvent.js";

/** Helper: create a mock domain event with toPayload() */
function createMockDomainEvent(
  overrides: Partial<DomainEvent & { toPayload(): Record<string, unknown> }> = {}
): DomainEvent & { toPayload(): Record<string, unknown> } {
  return {
    eventId: "evt-123",
    eventType: "PostCreated",
    aggregateId: "post-456",
    aggregateType: "Post",
    occurredAt: new Date("2026-02-23T12:00:00Z"),
    version: 1,
    toPayload: () => ({ postId: "post-456" }),
    ...overrides,
  };
}

describe("ComposedEventDispatcher", { concurrency: 1 }, () => {
  // The mocks implement all methods from their respective interfaces
  let mockInMemory: EventDispatcher;
  let mockPublisher: IntegrationEventPublisher;
  let dispatcher: ComposedEventDispatcher;
  let capturedPublishEvents: IntegrationEvent[];

  beforeEach((t: TestContext) => {
    capturedPublishEvents = [];

    mockInMemory = {
      dispatch: t.mock.fn(async () => {}),
      dispatchAll: t.mock.fn(async () => {}),
      register: t.mock.fn(() => {}),
    };

    mockPublisher = {
      publish: t.mock.fn(async (event: IntegrationEvent) => {
        capturedPublishEvents.push(event);
      }),
      publishBatch: t.mock.fn(async (events: readonly IntegrationEvent[]) => {
        capturedPublishEvents.push(...events);
      }),
      close: t.mock.fn(async () => {}),
    };

    dispatcher = new ComposedEventDispatcher(mockInMemory, mockPublisher);
  });

  describe("register()", { concurrency: 1 }, () => {
    it("delegates to inMemory.register()", (t) => {
      const handler: DomainEventHandler<DomainEvent> = { handle: t.mock.fn(async () => {}) };

      dispatcher.register("PostCreated", handler);

      const registerMock = mockInMemory.register as ReturnType<typeof import("node:test").mock.fn>;
      assert.equal(registerMock.mock.calls.length, 1);
      const call = registerMock.mock.calls[0];
      assert.ok(call);
      assert.equal(call.arguments[0], "PostCreated");
      assert.equal(call.arguments[1], handler);
    });
  });

  describe("dispatch()", { concurrency: 1 }, () => {
    it("calls inMemory.dispatch() with the event", async () => {
      const event = createMockDomainEvent();

      await dispatcher.dispatch(event);

      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      assert.equal(dispatchMock.mock.calls.length, 1);
      const call = dispatchMock.mock.calls[0];
      assert.ok(call);
      assert.equal(call.arguments[0], event);
    });

    it("calls publisher.publish() with the converted IntegrationEvent", async () => {
      const event = createMockDomainEvent({
        eventId: "evt-publish-check",
        eventType: "PostCreated",
        occurredAt: new Date("2026-02-23T12:00:00Z"),
      });

      await dispatcher.dispatch(event);

      assert.equal(capturedPublishEvents.length, 1);
      const published = capturedPublishEvents[0];
      assert.ok(published);
      assert.equal(published.eventId, "evt-publish-check");
      assert.equal(published.eventType, "PostCreated");
      assert.equal(published.source, "omnipost-api");
    });

    it("converts DomainEvent fields correctly in the IntegrationEvent", async () => {
      const event = createMockDomainEvent({
        eventId: "evt-conversion",
        eventType: "PostDeleted",
        aggregateId: "post-789",
        aggregateType: "Post",
        occurredAt: new Date("2026-02-23T15:30:00.000Z"),
        version: 2,
        toPayload: () => ({ postId: "post-789", reason: "test" }),
      });

      await dispatcher.dispatch(event);

      const published = capturedPublishEvents[0];
      assert.ok(published);
      assert.equal(published.eventId, "evt-conversion");
      assert.equal(published.eventType, "PostDeleted");
      assert.equal(published.aggregateId, "post-789");
      assert.equal(published.aggregateType, "Post");
      assert.equal(typeof published.occurredAt, "string");
      assert.equal(published.occurredAt, "2026-02-23T15:30:00.000Z");
      assert.equal(published.schemaVersion, 2);
      assert.deepEqual(published.payload, { postId: "post-789", reason: "test" });
      assert.equal(published.source, "omnipost-api");
    });

    it("succeeds even when publisher.publish() throws — error isolation", async (t) => {
      const throwingPublisher: IntegrationEventPublisher = {
        publish: t.mock.fn(async () => {
          throw new Error("BullMQ connection refused");
        }),
        publishBatch: t.mock.fn(async () => {}),
        close: t.mock.fn(async () => {}),
      };
      const isolatedDispatcher = new ComposedEventDispatcher(mockInMemory, throwingPublisher);
      const event = createMockDomainEvent();

      // Must not throw — BullMQ failure is swallowed
      await assert.doesNotReject(() => isolatedDispatcher.dispatch(event));

      // In-process dispatch still fired
      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      assert.equal(dispatchMock.mock.calls.length, 1);
    });

    it("calls inMemory.dispatch() before publisher.publish() (in-process first)", async (t) => {
      const callOrder: string[] = [];

      const orderedInMemory: EventDispatcher = {
        dispatch: t.mock.fn(async () => {
          callOrder.push("inMemory");
        }),
        dispatchAll: t.mock.fn(async () => {}),
        register: t.mock.fn(() => {}),
      };
      const orderedPublisher: IntegrationEventPublisher = {
        publish: t.mock.fn(async () => {
          callOrder.push("publisher");
        }),
        publishBatch: t.mock.fn(async () => {}),
        close: t.mock.fn(async () => {}),
      };
      const orderedDispatcher = new ComposedEventDispatcher(orderedInMemory, orderedPublisher);
      const event = createMockDomainEvent();

      await orderedDispatcher.dispatch(event);

      assert.deepEqual(callOrder, ["inMemory", "publisher"]);
    });
  });

  describe("dispatchAll()", { concurrency: 1 }, () => {
    it("calls inMemory.dispatch() for each event sequentially", async (t) => {
      const dispatchOrder: string[] = [];
      const sequentialInMemory: EventDispatcher = {
        dispatch: t.mock.fn(async (event: DomainEvent) => {
          dispatchOrder.push(event.eventId);
        }),
        dispatchAll: t.mock.fn(async () => {}),
        register: t.mock.fn(() => {}),
      };
      const sequentialDispatcher = new ComposedEventDispatcher(sequentialInMemory, mockPublisher);

      const events = [
        createMockDomainEvent({ eventId: "evt-first", eventType: "PostCreated" }),
        createMockDomainEvent({ eventId: "evt-second", eventType: "PostUpdated" }),
        createMockDomainEvent({ eventId: "evt-third", eventType: "PostDeleted" }),
      ];

      await sequentialDispatcher.dispatchAll(events);

      // inMemory.dispatch() called for each event
      const dispatchMock = sequentialInMemory.dispatch as ReturnType<
        typeof import("node:test").mock.fn
      >;
      assert.equal(dispatchMock.mock.calls.length, 3);

      // Order preserved
      assert.deepEqual(dispatchOrder, ["evt-first", "evt-second", "evt-third"]);
    });

    it("calls publisher.publishBatch() with all converted events", async () => {
      const events = [
        createMockDomainEvent({ eventId: "evt-batch-1", eventType: "PostCreated" }),
        createMockDomainEvent({ eventId: "evt-batch-2", eventType: "PostUpdated" }),
      ];

      await dispatcher.dispatchAll(events);

      const publishBatchMock = mockPublisher.publishBatch as ReturnType<
        typeof import("node:test").mock.fn
      >;
      assert.equal(publishBatchMock.mock.calls.length, 1);

      // Both events captured via capturedPublishEvents
      assert.equal(capturedPublishEvents.length, 2);
      assert.equal(capturedPublishEvents[0]?.eventId, "evt-batch-1");
      assert.equal(capturedPublishEvents[1]?.eventId, "evt-batch-2");
    });

    it("succeeds even when publisher.publishBatch() throws — error isolation", async (t) => {
      const throwingPublisher: IntegrationEventPublisher = {
        publish: t.mock.fn(async () => {}),
        publishBatch: t.mock.fn(async () => {
          throw new Error("BullMQ batch write failed");
        }),
        close: t.mock.fn(async () => {}),
      };
      const isolatedDispatcher = new ComposedEventDispatcher(mockInMemory, throwingPublisher);

      const events = [
        createMockDomainEvent({ eventId: "evt-a" }),
        createMockDomainEvent({ eventId: "evt-b" }),
      ];

      // Must not throw — BullMQ failure is swallowed
      await assert.doesNotReject(() => isolatedDispatcher.dispatchAll(events));

      // In-process dispatch still fired for both events
      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      assert.equal(dispatchMock.mock.calls.length, 2);
    });

    it("handles empty events array gracefully", async () => {
      await assert.doesNotReject(() => dispatcher.dispatchAll([]));

      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      assert.equal(dispatchMock.mock.calls.length, 0);

      assert.equal(capturedPublishEvents.length, 0);
    });
  });
});
