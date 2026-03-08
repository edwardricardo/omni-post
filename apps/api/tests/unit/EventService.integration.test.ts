import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPostEvent,
  createChannelEvent,
  createUserActionEvent,
  createAnalyticsEvent,
} from "../../src/events/EventService";
import { EVENT_TYPES, serializeEvent, deserializeEvent } from "@shared/events";

// ============================================================================
// Integration Tests - Cross-Helper Validation
// ============================================================================

describe("Integration Tests", () => {
  describe("Event Serialization and Deserialization", () => {
    it("should serialize and deserialize post events", () => {
      const original = createPostEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "project-456",
        { status: "DRAFT", title: "Test" },
        { source: "API" }
      );

      const serialized = serializeEvent(original);
      const deserialized = deserializeEvent(serialized);

      assert.strictEqual(deserialized.type, original.type);
      assert.strictEqual(deserialized.aggregateId, original.aggregateId);
      assert.strictEqual(deserialized.aggregateType, original.aggregateType);
      assert.strictEqual(deserialized.timestamp.toISOString(), original.timestamp.toISOString());
    });

    it("should serialize and deserialize analytics events with periods", () => {
      const original = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      const serialized = serializeEvent(original);
      const deserialized = deserializeEvent(serialized);

      // Note: Nested dates in period won't be deserialized automatically
      // This tests current behavior
      assert.strictEqual(typeof deserialized.data.period.start, "string");
      assert.strictEqual(typeof deserialized.data.period.end, "string");
    });
  });

  describe("Event Uniqueness Across Different Helpers", () => {
    it("should create unique events even with same IDs", () => {
      const postEvent = createPostEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "project-456",
        {},
        { source: "API" }
      );
      const channelEvent = createChannelEvent(
        EVENT_TYPES.CHANNEL_CONNECTED,
        "post-123", // Same ID but different aggregate type
        "project-456",
        {},
        { source: "OAuth" }
      );

      assert.notStrictEqual(postEvent.id, channelEvent.id);
      assert.strictEqual(postEvent.aggregateType, "Post");
      assert.strictEqual(channelEvent.aggregateType, "Channel");
    });
  });

  describe("Business Rule Consistency", () => {
    it("should maintain aggregateType consistency for post events", () => {
      const postEvent = createPostEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "project-456",
        {},
        { source: "API" }
      );
      const analyticsEvent = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      assert.strictEqual(postEvent.aggregateType, "Post");
      assert.strictEqual(analyticsEvent.aggregateType, "Post");
      assert.strictEqual(postEvent.aggregateId, analyticsEvent.aggregateId);
    });

    it("should use consistent version number across all helpers", () => {
      const postEvent = createPostEvent(
        EVENT_TYPES.POST_CREATED,
        "post-123",
        "project-456",
        {},
        { source: "API" }
      );
      const channelEvent = createChannelEvent(
        EVENT_TYPES.CHANNEL_CONNECTED,
        "ch-123",
        "project-456",
        {},
        { source: "OAuth" }
      );
      const userEvent = createUserActionEvent("user-123", "login", "Session", "session-456");
      const analyticsEvent = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      assert.strictEqual(postEvent.version, 1);
      assert.strictEqual(channelEvent.version, 1);
      assert.strictEqual(userEvent.version, 1);
      assert.strictEqual(analyticsEvent.version, 1);
    });
  });
});
