/**
 * Unit Tests - IntegrationEvent
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests for the toIntegrationEvent() factory function.
 * No external dependencies — pure logic only.
 */

import { describe, it, expect } from "vitest";
import { toIntegrationEvent } from "../../../src/infrastructure/integration-events/IntegrationEvent.js";
import type { DomainEvent } from "../../../src/domain/events/DomainEvent.js";

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
    metadata: { correlationId: "corr-1" },
    toPayload: () => ({ postId: "post-456", body: "Hello world" }),
    ...overrides,
  };
}

/** Helper: create a plain domain event without toPayload() */
function createPlainDomainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-plain",
    eventType: "PostScheduled",
    aggregateId: "post-789",
    aggregateType: "Post",
    occurredAt: new Date("2026-02-23T13:00:00Z"),
    version: 2,
    metadata: { scheduledAt: "2026-03-01T10:00:00Z" },
    ...overrides,
  };
}

describe("IntegrationEvent", () => {
  it("converts domain event with toPayload()", () => {
    const domainEvent = createMockDomainEvent();
    const result = toIntegrationEvent(domainEvent);

    expect(result.eventId).toBe("evt-123");
    expect(result.eventType).toBe("PostCreated");
    expect(result.aggregateId).toBe("post-456");
    expect(result.aggregateType).toBe("Post");
    expect(result.occurredAt).toBe("2026-02-23T12:00:00.000Z");
    expect(result.schemaVersion).toBe(1);
    expect(result.payload).toEqual({ postId: "post-456", body: "Hello world" });
    expect(result.source).toBe("omnipost-api");
  });

  it("converts domain event without toPayload() — falls back to metadata", () => {
    const domainEvent = createPlainDomainEvent();
    const result = toIntegrationEvent(domainEvent);

    expect(result.eventId).toBe("evt-plain");
    expect(result.eventType).toBe("PostScheduled");
    // payload should be the metadata object (fallback)
    expect(result.payload).toEqual({ scheduledAt: "2026-03-01T10:00:00Z" });
  });

  it("converts domain event with no toPayload() and no metadata — payload is {}", () => {
    const domainEvent: DomainEvent = {
      eventId: "evt-minimal",
      eventType: "Minimal",
      aggregateId: "agg-1",
      aggregateType: "Aggregate",
      occurredAt: new Date("2026-02-23T00:00:00Z"),
      version: 1,
      // no metadata, no toPayload
    };

    const result = toIntegrationEvent(domainEvent);

    expect(result.payload).toEqual({});
    expect(result.metadata).toEqual({});
  });

  it("preserves eventId for BullMQ job deduplication", () => {
    const domainEvent = createMockDomainEvent({ eventId: "dedup-event-id-xyz" });
    const result = toIntegrationEvent(domainEvent);

    expect(result.eventId).toBe("dedup-event-id-xyz");
  });

  it("sets schemaVersion from domain event version field", () => {
    const domainEvent = createMockDomainEvent({ version: 3 });
    const result = toIntegrationEvent(domainEvent);

    expect(result.schemaVersion).toBe(3);
  });

  it("handles Date occurredAt — converts to ISO 8601 string", () => {
    const date = new Date("2026-02-23T15:30:00.000Z");
    const domainEvent = createMockDomainEvent({ occurredAt: date });
    const result = toIntegrationEvent(domainEvent);

    expect(typeof result.occurredAt).toBe("string");
    expect(result.occurredAt).toBe("2026-02-23T15:30:00.000Z");
  });

  it("metadata defaults to empty object when domain event has no metadata", () => {
    const domainEvent: DomainEvent = {
      eventId: "evt-no-meta",
      eventType: "NoMeta",
      aggregateId: "agg-1",
      aggregateType: "Aggregate",
      occurredAt: new Date("2026-02-23T00:00:00Z"),
      version: 1,
      // metadata is optional, omit it
    };

    const result = toIntegrationEvent(domainEvent);

    expect(result.metadata).toEqual({});
  });
});
