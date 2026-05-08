/**
 * @file EventService.user-analytics.test.ts
 * @description Tests for createUserActionEvent
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { createUserActionEvent, createAnalyticsEvent } from "../../src/events/EventService";
import { EVENT_TYPES, validateEvent } from "@shared/events";

// ============================================================================
// createUserActionEvent Tests
// ============================================================================

describe("createUserActionEvent", () => {
  describe("Event Structure Validation", () => {
    it("should create event with aggregateType 'User'", () => {
      const event = createUserActionEvent("user-123", "login", "Session", "session-456");

      expect(event.aggregateType).toBe("User");
      expect(event.aggregateId).toBe("user-123");
      expect(event.type).toBe(EVENT_TYPES.USER_ACTION);
    });

    it("should always use EVENT_TYPES.USER_ACTION as type", () => {
      const event = createUserActionEvent("user-123", "delete_post", "Post", "post-789");

      expect(event.type).toBe(EVENT_TYPES.USER_ACTION);
    });
  });

  describe("Data Structure and Required Fields", () => {
    it("should include all required user action fields", () => {
      const event = createUserActionEvent("user-123", "create_post", "Post", "post-789");

      expect(event.data.userId).toBe("user-123");
      expect(event.data.action).toBe("create_post");
      expect(event.data.resourceType).toBe("Post");
      expect(event.data.resourceId).toBe("post-789");
      expect(event.data.timestamp instanceof Date).toBeTruthy();
    });

    it("should create timestamp at action time", () => {
      const before = new Date();
      const event = createUserActionEvent("user-123", "update_post", "Post", "post-789");
      const after = new Date();

      expect(event.data.timestamp >= before && event.data.timestamp <= after).toBeTruthy();
    });
  });

  describe("Optional Parameters - exactOptionalPropertyTypes Compliance", () => {
    it("should handle undefined details correctly", () => {
      const event = createUserActionEvent("user-123", "view_post", "Post", "post-789", undefined);

      // Details should be undefined, not included in data
      expect(event.data.details).toBe(undefined);
    });

    it("should handle empty details object", () => {
      const event = createUserActionEvent("user-123", "view_post", "Post", "post-789", {});

      expect(event.data.details).toStrictEqual({});
    });

    it("should preserve details when provided", () => {
      const details = {
        ip: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        referrer: "https://example.com",
      };
      const event = createUserActionEvent("user-123", "login", "Session", "session-456", details);

      expect(event.data.details).toStrictEqual(details);
    });

    it("should handle undefined sessionId correctly", () => {
      const event = createUserActionEvent(
        "user-123",
        "view_post",
        "Post",
        "post-789",
        undefined,
        undefined
      );

      // sessionId should be undefined
      expect(event.data.sessionId).toBe(undefined);
      // Metadata should not have sessionId field due to conditional spread
      expect(event.metadata.sessionId).toBe(undefined);
    });

    it("should propagate sessionId when provided", () => {
      const event = createUserActionEvent(
        "user-123",
        "create_post",
        "Post",
        "post-789",
        undefined,
        "session-999"
      );

      expect(event.data.sessionId).toBe("session-999");
      expect(event.metadata.sessionId).toBe("session-999");
    });

    it("should handle both details and sessionId", () => {
      const details = { reason: "test" };
      const event = createUserActionEvent(
        "user-123",
        "delete_post",
        "Post",
        "post-789",
        details,
        "session-888"
      );

      expect(event.data.details).toStrictEqual(details);
      expect(event.data.sessionId).toBe("session-888");
      expect(event.metadata.sessionId).toBe("session-888");
    });
  });

  describe("Metadata Propagation", () => {
    it("should set default source to 'API'", () => {
      const event = createUserActionEvent("user-123", "login", "Session", "session-456");

      expect(event.metadata.source).toBe("API");
    });

    it("should propagate userId to metadata", () => {
      const event = createUserActionEvent("user-123", "logout", "Session", "session-456");

      expect(event.metadata.userId).toBe("user-123");
    });

    it("should include sessionId in metadata when provided", () => {
      const event = createUserActionEvent(
        "user-123",
        "view_analytics",
        "Post",
        "post-789",
        undefined,
        "session-777"
      );

      expect(event.metadata.sessionId).toBe("session-777");
    });
  });

  describe("Action Types and Resource Types", () => {
    it("should handle various action types", () => {
      const actions = [
        "login",
        "logout",
        "create_post",
        "update_post",
        "delete_post",
        "view_analytics",
        "connect_channel",
        "disconnect_channel",
      ];

      actions.forEach((action) => {
        const event = createUserActionEvent("user-123", action, "Resource", "res-456");
        expect(event.data.action).toBe(action);
      });
    });

    it("should handle various resource types", () => {
      const resources = [
        { type: "Post", id: "post-123" },
        { type: "Channel", id: "ch-456" },
        { type: "Project", id: "proj-789" },
        { type: "User", id: "user-999" },
        { type: "Session", id: "session-111" },
      ];

      resources.forEach(({ type, id }) => {
        const event = createUserActionEvent("user-123", "view", type, id);
        expect(event.data.resourceType).toBe(type);
        expect(event.data.resourceId).toBe(id);
      });
    });
  });

  describe("Schema Validation", () => {
    it("should validate against UserActionEvent schema", () => {
      const event = createUserActionEvent("user-123", "create_post", "Post", "post-789", {
        title: "New Post",
      });

      expect(validateEvent(event)).toBeTruthy();
    });
  });
});

// ============================================================================
// createAnalyticsEvent Tests
// ============================================================================

describe("createAnalyticsEvent", () => {
  describe("Event Structure Validation", () => {
    it("should create event with aggregateType 'Post'", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      expect(event.aggregateType).toBe("Post");
      expect(event.aggregateId).toBe("post-123");
      expect(event.type).toBe(EVENT_TYPES.ANALYTICS_COLLECTED);
    });

    it("should always use EVENT_TYPES.ANALYTICS_COLLECTED as type", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "instagram", {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      });

      expect(event.type).toBe(EVENT_TYPES.ANALYTICS_COLLECTED);
    });
  });

  describe("Data Structure and Required Fields", () => {
    it("should include all required analytics fields", () => {
      const metrics = {
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
      };
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", metrics);

      expect(event.data.postId).toBe("post-123");
      expect(event.data.channelId).toBe("ch-456");
      expect(event.data.provider).toBe("twitter");
      expect(event.data.metrics).toStrictEqual(metrics);
      expect(event.data.collectedAt instanceof Date).toBeTruthy();
      expect(event.data.period).toBeTruthy();
      expect(event.data.period.start instanceof Date).toBeTruthy();
      expect(event.data.period.end instanceof Date).toBeTruthy();
    });

    it("should create collectedAt timestamp at event creation time", () => {
      const before = new Date();
      const event = createAnalyticsEvent("post-123", "ch-456", "facebook", {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      });
      const after = new Date();

      expect(event.data.collectedAt >= before && event.data.collectedAt <= after).toBeTruthy();
    });
  });

  describe("Period Calculation - 24 Hour Window", () => {
    it("should calculate period with 24-hour lookback", () => {
      const beforeCreation = Date.now();
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });
      const afterCreation = Date.now();

      const expectedStart = beforeCreation - 24 * 60 * 60 * 1000;
      const actualStart = event.data.period.start.getTime();

      // Allow 100ms tolerance for test execution time
      expect(Math.abs(actualStart - expectedStart) < 100).toBeTruthy();

      // Period end should be at event creation time
      const actualEnd = event.data.period.end.getTime();
      expect(actualEnd >= beforeCreation && actualEnd <= afterCreation).toBeTruthy();
    });

    it("should have period.start exactly 24 hours before period.end", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "instagram", {
        views: 500,
        likes: 25,
        comments: 10,
        shares: 5,
      });

      const duration = event.data.period.end.getTime() - event.data.period.start.getTime();
      const expectedDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      expect(duration).toBe(expectedDuration);
    });

    it("should create different periods for events created at different times", async () => {
      const event1 = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      // Wait 10ms to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const event2 = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 110,
        likes: 11,
        comments: 5,
        shares: 2,
      });

      expect(event1.data.period.start.getTime()).not.toBe(event2.data.period.start.getTime());
      expect(event1.data.period.end.getTime()).not.toBe(event2.data.period.end.getTime());
    });
  });

  describe("Metrics Handling", () => {
    it("should preserve basic metrics structure", () => {
      const metrics = {
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
      };
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", metrics);

      expect(event.data.metrics).toStrictEqual(metrics);
    });

    it("should handle optional metrics fields", () => {
      const metrics = {
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
        reach: 5000,
        impressions: 8000,
        engagementRate: 0.065,
      };
      const event = createAnalyticsEvent("post-123", "ch-456", "instagram", metrics);

      expect(event.data.metrics.reach).toBe(5000);
      expect(event.data.metrics.impressions).toBe(8000);
      expect(event.data.metrics.engagementRate).toBe(0.065);
    });

    it("should handle zero metrics", () => {
      const metrics = {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      };
      const event = createAnalyticsEvent("post-123", "ch-456", "facebook", metrics);

      expect(event.data.metrics).toStrictEqual(metrics);
    });

    it("should handle large metric numbers", () => {
      const metrics = {
        views: 10000000,
        likes: 500000,
        comments: 100000,
        shares: 50000,
        reach: 50000000,
      };
      const event = createAnalyticsEvent("post-123", "ch-456", "youtube", metrics);

      expect(event.data.metrics).toStrictEqual(metrics);
    });
  });

  describe("Provider Support", () => {
    it("should handle different provider types", () => {
      const providers = ["twitter", "instagram", "facebook", "youtube", "tiktok", "linkedin"];

      providers.forEach((provider) => {
        const event = createAnalyticsEvent("post-123", "ch-456", provider, {
          views: 100,
          likes: 10,
          comments: 5,
          shares: 2,
        });

        expect(event.data.provider).toBe(provider);
      });
    });
  });

  describe("Metadata Propagation", () => {
    it("should set default source to 'AnalyticsCollector'", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      });

      expect(event.metadata.source).toBe("AnalyticsCollector");
    });

    it("should not include userId in metadata by default", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "instagram", {
        views: 200,
        likes: 20,
        comments: 10,
        shares: 5,
      });

      expect(event.metadata.userId).toBe(undefined);
    });
  });

  describe("Schema Validation", () => {
    it("should validate against AnalyticsCollectedEvent schema", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "twitter", {
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
      });

      expect(validateEvent(event)).toBeTruthy();
    });

    it("should validate with optional metrics fields", () => {
      const event = createAnalyticsEvent("post-123", "ch-456", "instagram", {
        views: 1000,
        likes: 50,
        comments: 20,
        shares: 10,
        reach: 5000,
        impressions: 8000,
        engagementRate: 0.065,
      });

      expect(validateEvent(event)).toBeTruthy();
    });
  });
});
