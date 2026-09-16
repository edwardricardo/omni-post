/**
 * @file integrationEventDeliveryHandler.test.ts
 * @description Tests the bridge between OutboxRelay-dispatched events and the
 *              customer-facing integration delivery service. Verifies the
 *              event-name mapping, payload enrichment, and error propagation
 *              semantics that the outbox relay relies on for retries.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  IntegrationEventDeliveryHandler,
  INTEGRATION_EVENT_NAMES,
  HANDLED_EVENT_TYPES,
} from "../../src/integrations/IntegrationEventDeliveryHandler.js";
import type { TriggerIntegrationEventService } from "@core/integrations/TriggerIntegrationEventService";
import type { DomainEvent } from "@core/domain/events/DomainEvent";

function makeOutboxEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-1",
    eventType: "PostPublished",
    aggregateId: "post-1",
    aggregateType: "Post",
    occurredAt: new Date("2026-05-09T00:00:00Z"),
    version: 1,
    metadata: { payload: { postId: "post-1", channelIds: ["ch-1"] }, fromOutbox: true },
    ...overrides,
  };
}

function makeMockTrigger(): TriggerIntegrationEventService & {
  fire: ReturnType<typeof vi.fn>;
} {
  return {
    fire: vi.fn(async () => undefined),
  } as unknown as TriggerIntegrationEventService & { fire: ReturnType<typeof vi.fn> };
}

describe("IntegrationEventDeliveryHandler", () => {
  let trigger: ReturnType<typeof makeMockTrigger>;
  let handler: IntegrationEventDeliveryHandler;

  beforeEach(() => {
    trigger = makeMockTrigger();
    handler = new IntegrationEventDeliveryHandler(trigger);
  });

  it("maps PostPublished to post.published and forwards the payload", async () => {
    await handler.handle(makeOutboxEvent());

    expect(trigger.fire).toHaveBeenCalledTimes(1);
    const [eventName, payload] = trigger.fire.mock.calls[0]!;
    expect(eventName).toBe("post.published");
    expect(payload).toMatchObject({
      postId: "post-1",
      channelIds: ["ch-1"],
      eventId: "evt-1",
      eventType: "post.published",
      aggregateId: "post-1",
      aggregateType: "Post",
    });
  });

  it("silently drops events not in the public catalog", async () => {
    await handler.handle(makeOutboxEvent({ eventType: "InternalCacheInvalidated" }));
    expect(trigger.fire).not.toHaveBeenCalled();
  });

  it("does not deliver PostPublishingStarted to subscribers", async () => {
    // The hop that emits it runs AFTER the provider has already published, so a
    // subscriber would be told publishing started at a moment when it had
    // finished. The outbox row is still written — it is the aggregate's own
    // event — but it is not projected outward.
    await handler.handle(makeOutboxEvent({ eventType: "PostPublishingStarted" }));
    expect(trigger.fire).not.toHaveBeenCalled();
  });

  it("the public catalog declares no publishing_started event", () => {
    expect(INTEGRATION_EVENT_NAMES.PostPublishingStarted).toBeUndefined();
    expect(Object.values(INTEGRATION_EVENT_NAMES)).not.toContain("post.publishing_started");
    // HANDLED_EVENT_TYPES derives from the keys, so boot registration shrinks
    // with the catalog rather than keeping a dispatcher entry that maps to
    // nothing.
    expect(HANDLED_EVENT_TYPES).not.toContain("PostPublishingStarted");
  });

  it("propagates fire() failures so the outbox relay can retry", async () => {
    const error = new Error("subscription repo unreachable");
    trigger.fire.mockRejectedValueOnce(error);

    await expect(handler.handle(makeOutboxEvent())).rejects.toBe(error);
  });

  it("handles empty metadata.payload without crashing", async () => {
    await handler.handle(makeOutboxEvent({ metadata: { fromOutbox: true } }));

    expect(trigger.fire).toHaveBeenCalledTimes(1);
    const [, payload] = trigger.fire.mock.calls[0]!;
    expect(payload).toMatchObject({
      eventId: "evt-1",
      eventType: "post.published",
      aggregateId: "post-1",
    });
  });

  it("HANDLED_EVENT_TYPES matches the keys of INTEGRATION_EVENT_NAMES", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toStrictEqual(
      Object.keys(INTEGRATION_EVENT_NAMES).sort()
    );
  });

  it("public catalog uses snake_case dotted naming (no internal PascalCase leak)", () => {
    for (const publicName of Object.values(INTEGRATION_EVENT_NAMES)) {
      expect(publicName).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });
});
