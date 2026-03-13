/**
 * Unit Tests - EventSchemaRegistry
 *
 * Part of P2-5: Event Versioning Strategy
 * Tier-0 tests for schema registration, version lookup, and payload validation.
 *
 * Strategy:
 * - All tests are pure in-memory — no database, no Redis, no I/O.
 * - The default constructor pre-registers 12 production events at v1.
 * - Custom schemas are registered via registry.register() for multi-version tests.
 */

import { describe, it, beforeAll, expect } from "vitest";
import { z } from "zod";
import { EventSchemaRegistry } from "../../../src/infrastructure/integration-events/EventSchemaRegistry.js";

// ---------------------------------------------------------------------------
// Default registry (pre-populated with all 12 production events at v1)
// ---------------------------------------------------------------------------

describe("EventSchemaRegistry — default constructor", () => {
  let registry: EventSchemaRegistry;

  beforeAll(() => {
    registry = new EventSchemaRegistry();
  });

  it("registers all 12 production events", () => {
    const expected = [
      "PostCreated",
      "PostContentUpdated",
      "PostScheduled",
      "PostUnscheduled",
      "PostPublishingStarted",
      "PostPublished",
      "PostPublishingFailed",
      "PostCancelled",
      "PostMediaAdded",
      "PostMediaRemoved",
      "CrisisModeEntered",
      "CrisisModeExited",
    ].sort();

    const registered = registry.registeredEventTypes.sort();
    expect(registered).toEqual(expected);
  });

  it("getCurrentVersion returns 1 for all pre-registered events", () => {
    for (const eventType of registry.registeredEventTypes) {
      const version = registry.getCurrentVersion(eventType);
      expect(version).toBe(1);
    }
  });

  it("getSchema returns a schema for PostCreated v1", () => {
    const schema = registry.getSchema("PostCreated", 1);
    expect(schema !== undefined).toBeTruthy();
  });

  it("getSchema returns undefined for unknown event type", () => {
    const schema = registry.getSchema("UnknownEvent", 1);
    expect(schema).toBe(undefined);
  });

  it("getSchema returns undefined for unknown version of known event type", () => {
    const schema = registry.getSchema("PostCreated", 99);
    expect(schema).toBe(undefined);
  });

  it("getCurrentVersion returns undefined for unknown event type", () => {
    const version = registry.getCurrentVersion("SomeOtherEvent");
    expect(version).toBe(undefined);
  });

  it("hasEventType returns true for PostPublished", () => {
    expect(registry.hasEventType("PostPublished")).toBe(true);
  });

  it("hasEventType returns false for unknown event type", () => {
    expect(registry.hasEventType("UnknownEvent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation — correct payloads
// ---------------------------------------------------------------------------

describe("EventSchemaRegistry — validate correct payloads", () => {
  let registry: EventSchemaRegistry;

  beforeAll(() => {
    registry = new EventSchemaRegistry();
  });

  it("validates PostCreated v1 with all required fields", () => {
    const result = registry.validate("PostCreated", 1, {
      postId: "post-1",
      projectId: "proj-1",
      body: "Hello world",
      locale: "en",
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostCreated v1 with optional title present", () => {
    const result = registry.validate("PostCreated", 1, {
      postId: "post-1",
      projectId: "proj-1",
      body: "Hello",
      locale: "es",
      title: "My Post",
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostPublished v1 with providerResults", () => {
    const result = registry.validate("PostPublished", 1, {
      postId: "post-2",
      publishedAt: "2026-02-23T12:00:00.000Z",
      providerResults: {
        twitter: { success: true, externalId: "tweet-123" },
        instagram: { success: false, error: "Token expired" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostScheduled v1", () => {
    const result = registry.validate("PostScheduled", 1, {
      postId: "post-3",
      scheduledAt: "2026-03-01T10:00:00.000Z",
      timezone: "America/New_York",
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostPublishingFailed v1", () => {
    const result = registry.validate("PostPublishingFailed", 1, {
      postId: "post-4",
      error: "Connection timeout",
      failedProviders: ["twitter", "instagram"],
      retryable: true,
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostCancelled v1 with optional reason present", () => {
    const result = registry.validate("PostCancelled", 1, {
      postId: "post-5",
      previousStatus: "SCHEDULED",
      reason: "User cancelled",
    });
    expect(result.ok).toBe(true);
  });

  it("validates PostCancelled v1 without optional reason", () => {
    const result = registry.validate("PostCancelled", 1, {
      postId: "post-5",
      previousStatus: "SCHEDULED",
    });
    expect(result.ok).toBe(true);
  });

  it("validates CrisisModeEntered v1", () => {
    const result = registry.validate("CrisisModeEntered", 1, {
      projectId: "proj-10",
      reason: "Account compromised",
      startedAt: "2026-02-23T08:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("validates CrisisModeExited v1", () => {
    const result = registry.validate("CrisisModeExited", 1, {
      projectId: "proj-10",
      reason: "Resolved",
      startedAt: "2026-02-23T08:00:00.000Z",
      endedAt: "2026-02-23T09:00:00.000Z",
      durationMs: 3600000,
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation — invalid payloads
// ---------------------------------------------------------------------------

describe("EventSchemaRegistry — validate invalid payloads", () => {
  let registry: EventSchemaRegistry;

  beforeAll(() => {
    registry = new EventSchemaRegistry();
  });

  it("returns error for missing required field in PostCreated", () => {
    const result = registry.validate("PostCreated", 1, {
      postId: "post-1",
      // projectId is missing
      body: "Hello",
      locale: "en",
    });
    expect(result.ok).toBe(false);
    expect(result.ok && result.errors.length > 0).toBeFalsy();
  });

  it("returns error for wrong type in PostPublishingFailed.retryable", () => {
    const result = registry.validate("PostPublishingFailed", 1, {
      postId: "post-4",
      error: "timeout",
      failedProviders: ["twitter"],
      retryable: "yes", // should be boolean
    });
    expect(result.ok).toBe(false);
    expect(result.ok && result.errors.length > 0).toBeFalsy();
  });

  it("returns error for unknown event type", () => {
    const result = registry.validate("UnknownEvent", 1, { anything: true });
    expect(result.ok).toBe(false);
    expect(result.ok && result.errors[0]?.includes("No schema registered")).toBeFalsy();
  });

  it("returns error for unknown version of known event type", () => {
    const result = registry.validate("PostCreated", 99, {
      postId: "post-1",
      projectId: "proj-1",
      body: "Hello",
      locale: "en",
    });
    expect(result.ok).toBe(false);
    expect(result.ok && result.errors[0]?.includes("No schema registered")).toBeFalsy();
  });

  it("returns error for CrisisModeExited with non-number durationMs", () => {
    const result = registry.validate("CrisisModeExited", 1, {
      projectId: "proj-10",
      reason: "Resolved",
      startedAt: "2026-02-23T08:00:00.000Z",
      endedAt: "2026-02-23T09:00:00.000Z",
      durationMs: "3600000", // should be number
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple versions for the same event type
// ---------------------------------------------------------------------------

describe("EventSchemaRegistry — multiple versions", () => {
  let registry: EventSchemaRegistry;

  beforeAll(() => {
    registry = new EventSchemaRegistry();
    // Register a v2 schema for PostCreated that adds a new required field
    registry.register(
      "PostCreated",
      2,
      z.object({
        postId: z.string(),
        projectId: z.string(),
        body: z.string(),
        locale: z.string(),
        title: z.string().optional(),
        tags: z.array(z.string()), // new required field in v2
      })
    );
  });

  it("getCurrentVersion returns 2 after registering v2", () => {
    const version = registry.getCurrentVersion("PostCreated");
    expect(version).toBe(2);
  });

  it("getSchema v1 and v2 return different schemas", () => {
    const v1 = registry.getSchema("PostCreated", 1);
    const v2 = registry.getSchema("PostCreated", 2);
    expect(v1 !== undefined).toBeTruthy();
    expect(v2 !== undefined).toBeTruthy();
    expect(v1 !== v2).toBeTruthy();
  });

  it("v1 payload is valid against v1 schema", () => {
    const result = registry.validate("PostCreated", 1, {
      postId: "p1",
      projectId: "proj-1",
      body: "Hello",
      locale: "en",
    });
    expect(result.ok).toBe(true);
  });

  it("v2 payload with tags is valid against v2 schema", () => {
    const result = registry.validate("PostCreated", 2, {
      postId: "p1",
      projectId: "proj-1",
      body: "Hello",
      locale: "en",
      tags: ["news", "tech"],
    });
    expect(result.ok).toBe(true);
  });

  it("v1 payload (missing tags) fails v2 schema", () => {
    const result = registry.validate("PostCreated", 2, {
      postId: "p1",
      projectId: "proj-1",
      body: "Hello",
      locale: "en",
      // no tags — required in v2
    });
    expect(result.ok).toBe(false);
  });

  it("registering a third version updates getCurrentVersion to 3", () => {
    registry.register(
      "PostCreated",
      3,
      z.object({
        postId: z.string(),
        projectId: z.string(),
        body: z.string(),
        locale: z.string(),
        title: z.string().optional(),
        tags: z.array(z.string()),
        contentType: z.enum(["text", "image", "video"]), // new in v3
      })
    );
    expect(registry.getCurrentVersion("PostCreated")).toBe(3);
  });

  it("custom event type registered in isolation has correct version", () => {
    const fresh = new EventSchemaRegistry();
    fresh.register("MyCustomEvent", 5, z.object({ id: z.string() }));
    expect(fresh.getCurrentVersion("MyCustomEvent")).toBe(5);
    expect(fresh.getSchema("MyCustomEvent", 5) !== undefined).toBe(true);
    expect(fresh.getSchema("MyCustomEvent", 1)).toBe(undefined);
  });
});
