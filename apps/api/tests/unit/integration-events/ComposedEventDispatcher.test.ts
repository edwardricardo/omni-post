/**
 * Unit Tests - ComposedEventDispatcher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests for the ComposedEventDispatcher class.
 * Uses mocked InMemoryEventDispatcher and IntegrationEventPublisher — no external deps.
 *
 * @file ComposedEventDispatcher.test.ts
 * @description Tests for ComposedEventDispatcher
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ComposedEventDispatcher } from "../../../src/infrastructure/integration-events/ComposedEventDispatcher.js";
import type {
  EventDispatcher,
  DomainEvent,
  DomainEventHandler,
} from "@core/domain/events/DomainEvent.js";
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

describe("ComposedEventDispatcher", () => {
  // The mocks implement all methods from their respective interfaces
  let mockInMemory: EventDispatcher;
  let mockPublisher: IntegrationEventPublisher;
  let dispatcher: ComposedEventDispatcher;
  let capturedPublishEvents: IntegrationEvent[];

  beforeEach(() => {
    capturedPublishEvents = [];

    mockInMemory = {
      dispatch: vi.fn(async () => {}),
      dispatchAll: vi.fn(async () => {}),
      register: vi.fn(() => {}),
    };

    mockPublisher = {
      publish: vi.fn(async (event: IntegrationEvent) => {
        capturedPublishEvents.push(event);
      }),
      publishBatch: vi.fn(async (events: readonly IntegrationEvent[]) => {
        capturedPublishEvents.push(...events);
      }),
      close: vi.fn(async () => {}),
    };

    dispatcher = new ComposedEventDispatcher(mockInMemory, mockPublisher);
  });

  describe("register()", () => {
    it("delegates to inMemory.register()", (_t) => {
      const handler: DomainEventHandler<DomainEvent> = { handle: vi.fn(async () => {}) };

      dispatcher.register("PostCreated", handler);

      const registerMock = mockInMemory.register as ReturnType<typeof import("node:test").mock.fn>;
      expect(registerMock.mock.calls.length).toBe(1);
      const call = registerMock.mock.calls[0];
      expect(call).toBeTruthy();
      expect(call[0]).toBe("PostCreated");
      expect(call[1]).toBe(handler);
    });
  });

  describe("dispatch()", () => {
    it("calls inMemory.dispatch() with the event", async () => {
      const event = createMockDomainEvent();

      await dispatcher.dispatch(event);

      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      expect(dispatchMock.mock.calls.length).toBe(1);
      const call = dispatchMock.mock.calls[0];
      expect(call).toBeTruthy();
      expect(call[0]).toBe(event);
    });

    it("calls publisher.publish() with the converted IntegrationEvent", async () => {
      const event = createMockDomainEvent({
        eventId: "evt-publish-check",
        eventType: "PostCreated",
        occurredAt: new Date("2026-02-23T12:00:00Z"),
      });

      await dispatcher.dispatch(event);

      expect(capturedPublishEvents.length).toBe(1);
      const published = capturedPublishEvents[0];
      expect(published).toBeTruthy();
      expect(published.eventId).toBe("evt-publish-check");
      expect(published.eventType).toBe("PostCreated");
      expect(published.source).toBe("omnipost-api");
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
      expect(published).toBeTruthy();
      expect(published.eventId).toBe("evt-conversion");
      expect(published.eventType).toBe("PostDeleted");
      expect(published.aggregateId).toBe("post-789");
      expect(published.aggregateType).toBe("Post");
      expect(typeof published.occurredAt).toBe("string");
      expect(published.occurredAt).toBe("2026-02-23T15:30:00.000Z");
      expect(published.schemaVersion).toBe(2);
      expect(published.payload).toEqual({ postId: "post-789", reason: "test" });
      expect(published.source).toBe("omnipost-api");
    });

    it("succeeds even when publisher.publish() throws — error isolation", async (_t) => {
      const throwingPublisher: IntegrationEventPublisher = {
        publish: vi.fn(async () => {
          throw new Error("BullMQ connection refused");
        }),
        publishBatch: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      const isolatedDispatcher = new ComposedEventDispatcher(mockInMemory, throwingPublisher);
      const event = createMockDomainEvent();

      // Must not throw — BullMQ failure is swallowed
      await expect(isolatedDispatcher.dispatch(event)).resolves.not.toThrow();

      // In-process dispatch still fired
      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      expect(dispatchMock.mock.calls.length).toBe(1);
    });

    it("calls inMemory.dispatch() before publisher.publish() (in-process first)", async (_t) => {
      const callOrder: string[] = [];

      const orderedInMemory: EventDispatcher = {
        dispatch: vi.fn(async () => {
          callOrder.push("inMemory");
        }),
        dispatchAll: vi.fn(async () => {}),
        register: vi.fn(() => {}),
      };
      const orderedPublisher: IntegrationEventPublisher = {
        publish: vi.fn(async () => {
          callOrder.push("publisher");
        }),
        publishBatch: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      const orderedDispatcher = new ComposedEventDispatcher(orderedInMemory, orderedPublisher);
      const event = createMockDomainEvent();

      await orderedDispatcher.dispatch(event);

      expect(callOrder).toEqual(["inMemory", "publisher"]);
    });
  });

  describe("dispatchAll()", () => {
    it("calls inMemory.dispatch() for each event sequentially", async (_t) => {
      const dispatchOrder: string[] = [];
      const sequentialInMemory: EventDispatcher = {
        dispatch: vi.fn(async (event: DomainEvent) => {
          dispatchOrder.push(event.eventId);
        }),
        dispatchAll: vi.fn(async () => {}),
        register: vi.fn(() => {}),
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
      expect(dispatchMock.mock.calls.length).toBe(3);

      // Order preserved
      expect(dispatchOrder).toEqual(["evt-first", "evt-second", "evt-third"]);
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
      expect(publishBatchMock.mock.calls.length).toBe(1);

      // Both events captured via capturedPublishEvents
      expect(capturedPublishEvents.length).toBe(2);
      expect(capturedPublishEvents[0]?.eventId).toBe("evt-batch-1");
      expect(capturedPublishEvents[1]?.eventId).toBe("evt-batch-2");
    });

    it("succeeds even when publisher.publishBatch() throws — error isolation", async (_t) => {
      const throwingPublisher: IntegrationEventPublisher = {
        publish: vi.fn(async () => {}),
        publishBatch: vi.fn(async () => {
          throw new Error("BullMQ batch write failed");
        }),
        close: vi.fn(async () => {}),
      };
      const isolatedDispatcher = new ComposedEventDispatcher(mockInMemory, throwingPublisher);

      const events = [
        createMockDomainEvent({ eventId: "evt-a" }),
        createMockDomainEvent({ eventId: "evt-b" }),
      ];

      // Must not throw — BullMQ failure is swallowed
      await expect(isolatedDispatcher.dispatchAll(events)).resolves.not.toThrow();

      // In-process dispatch still fired for both events
      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      expect(dispatchMock.mock.calls.length).toBe(2);
    });

    it("handles empty events array gracefully", async () => {
      await expect(dispatcher.dispatchAll([])).resolves.not.toThrow();

      const dispatchMock = mockInMemory.dispatch as ReturnType<typeof import("node:test").mock.fn>;
      expect(dispatchMock.mock.calls.length).toBe(0);

      expect(capturedPublishEvents.length).toBe(0);
    });
  });
});
