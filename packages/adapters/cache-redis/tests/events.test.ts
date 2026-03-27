/**
 * @file events.test.ts
 * @description Mutation-killing tests for CacheEventManager, CacheInvalidationPatterns,
 * and createCacheEventManager factory. Covers handler registration, event dispatch,
 * entity CRUD handlers, predefined patterns, and error handling.
 * @layer test
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import client from "prom-client";
import {
  CacheEventManager,
  CacheInvalidationPatterns,
  createCacheEventManager,
  type DomainEvent,
} from "../src/events.js";

// Clear prom-client registry for isolation
client.register.clear();

// ============================================================================
// Mock CacheManager
// ============================================================================

function createMockCacheManager() {
  return {
    invalidate: vi.fn(async () => {}),
    invalidateByTag: vi.fn(async () => {}),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function makeDomainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "evt-001",
    eventType: "post.created",
    aggregateId: "post-123",
    aggregateType: "Post",
    data: { projectId: "proj-1" },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// CacheEventManager
// ============================================================================

describe("CacheEventManager", () => {
  let manager: CacheEventManager;
  let mockCache: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCache = createMockCacheManager();
    manager = new CacheEventManager(mockCache);
  });

  // =========================================================================
  // registerHandler
  // =========================================================================

  describe("registerHandler", () => {
    it("registers a handler for an event type", () => {
      const handler = {
        eventType: "post.created",
        handle: vi.fn(async () => {}),
      };

      manager.registerHandler("post.created", handler);

      const events = manager.getRegisteredEvents();
      expect(events).toContain("post.created");
    });

    it("allows multiple handlers for the same event type", () => {
      const handler1 = { eventType: "post.created", handle: vi.fn(async () => {}) };
      const handler2 = { eventType: "post.created", handle: vi.fn(async () => {}) };

      manager.registerHandler("post.created", handler1);
      manager.registerHandler("post.created", handler2);

      const events = manager.getRegisteredEvents();
      expect(events).toContain("post.created");
      // Both handlers should be called when event fires
    });

    it("registers handlers for different event types", () => {
      manager.registerHandler("post.created", {
        eventType: "post.created",
        handle: vi.fn(async () => {}),
      });
      manager.registerHandler("post.deleted", {
        eventType: "post.deleted",
        handle: vi.fn(async () => {}),
      });

      const events = manager.getRegisteredEvents();
      expect(events).toContain("post.created");
      expect(events).toContain("post.deleted");
      expect(events).toHaveLength(2);
    });
  });

  // =========================================================================
  // handleEvent
  // =========================================================================

  describe("handleEvent", () => {
    it("calls registered handler when matching event fires", async () => {
      const handler = { eventType: "post.created", handle: vi.fn(async () => {}) };
      manager.registerHandler("post.created", handler);

      const event = makeDomainEvent({ eventType: "post.created" });
      await manager.handleEvent(event);

      expect(handler.handle).toHaveBeenCalledWith(event);
      expect(handler.handle).toHaveBeenCalledTimes(1);
    });

    it("calls all handlers for the same event type", async () => {
      const handler1 = { eventType: "post.created", handle: vi.fn(async () => {}) };
      const handler2 = { eventType: "post.created", handle: vi.fn(async () => {}) };

      manager.registerHandler("post.created", handler1);
      manager.registerHandler("post.created", handler2);

      await manager.handleEvent(makeDomainEvent({ eventType: "post.created" }));

      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
    });

    it("does not call handlers for different event types", async () => {
      const handler = { eventType: "post.deleted", handle: vi.fn(async () => {}) };
      manager.registerHandler("post.deleted", handler);

      await manager.handleEvent(makeDomainEvent({ eventType: "post.created" }));

      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("does nothing when no handlers registered for event type", async () => {
      await manager.handleEvent(makeDomainEvent({ eventType: "unknown.event" }));
      // Should not throw
    });

    it("catches errors from handlers without throwing", async () => {
      const handler = {
        eventType: "post.created",
        handle: vi.fn(async () => {
          throw new Error("Handler failed");
        }),
      };
      manager.registerHandler("post.created", handler);

      await expect(
        manager.handleEvent(makeDomainEvent({ eventType: "post.created" }))
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // registerEntityHandlers
  // =========================================================================

  describe("registerEntityHandlers", () => {
    it("registers created handler that calls invalidateByTag", async () => {
      manager.registerEntityHandlers("post", {
        onCreated: (event) => [`posts:${event.data.projectId}`],
      });

      await manager.handleEvent(
        makeDomainEvent({
          eventType: "post.created",
          data: { projectId: "proj-1" },
        })
      );

      expect(mockCache.invalidateByTag).toHaveBeenCalledWith("posts:proj-1");
    });

    it("registers updated handler that calls invalidate with keys", async () => {
      manager.registerEntityHandlers("post", {
        onUpdated: (event) => [`post:${event.aggregateId}`],
      });

      await manager.handleEvent(
        makeDomainEvent({
          eventType: "post.updated",
          aggregateId: "post-456",
        })
      );

      expect(mockCache.invalidate).toHaveBeenCalledWith(["post:post-456"]);
    });

    it("registers deleted handler that calls invalidate with keys", async () => {
      manager.registerEntityHandlers("post", {
        onDeleted: (event) => [`post:${event.aggregateId}`],
      });

      await manager.handleEvent(
        makeDomainEvent({
          eventType: "post.deleted",
          aggregateId: "post-789",
        })
      );

      expect(mockCache.invalidate).toHaveBeenCalledWith(["post:post-789"]);
    });

    it("does not register handler when callback is not provided", () => {
      manager.registerEntityHandlers("post", {});

      const events = manager.getRegisteredEvents();
      expect(events).toHaveLength(0);
    });

    it("does not invalidate when onCreated returns empty array", async () => {
      manager.registerEntityHandlers("post", {
        onCreated: () => [],
      });

      await manager.handleEvent(makeDomainEvent({ eventType: "post.created" }));

      expect(mockCache.invalidateByTag).not.toHaveBeenCalled();
    });

    it("does not invalidate when onUpdated returns empty array", async () => {
      manager.registerEntityHandlers("post", {
        onUpdated: () => [],
      });

      await manager.handleEvent(makeDomainEvent({ eventType: "post.updated" }));

      expect(mockCache.invalidate).not.toHaveBeenCalled();
    });

    it("does not invalidate when onDeleted returns empty array", async () => {
      manager.registerEntityHandlers("post", {
        onDeleted: () => [],
      });

      await manager.handleEvent(makeDomainEvent({ eventType: "post.deleted" }));

      expect(mockCache.invalidate).not.toHaveBeenCalled();
    });

    it("registers all three handlers when all callbacks provided", () => {
      manager.registerEntityHandlers("post", {
        onCreated: () => ["tag1"],
        onUpdated: () => ["key1"],
        onDeleted: () => ["key2"],
      });

      const events = manager.getRegisteredEvents();
      expect(events).toContain("post.created");
      expect(events).toContain("post.updated");
      expect(events).toContain("post.deleted");
      expect(events).toHaveLength(3);
    });
  });

  // =========================================================================
  // clearHandlers
  // =========================================================================

  describe("clearHandlers", () => {
    it("removes all registered handlers", () => {
      manager.registerHandler("post.created", {
        eventType: "post.created",
        handle: vi.fn(async () => {}),
      });
      manager.registerHandler("post.deleted", {
        eventType: "post.deleted",
        handle: vi.fn(async () => {}),
      });

      manager.clearHandlers();

      expect(manager.getRegisteredEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // getRegisteredEvents
  // =========================================================================

  describe("getRegisteredEvents", () => {
    it("returns empty array when no handlers registered", () => {
      expect(manager.getRegisteredEvents()).toEqual([]);
    });

    it("returns array of registered event types", () => {
      manager.registerHandler("a", { eventType: "a", handle: vi.fn(async () => {}) });
      manager.registerHandler("b", { eventType: "b", handle: vi.fn(async () => {}) });

      const events = manager.getRegisteredEvents();
      expect(events).toContain("a");
      expect(events).toContain("b");
    });
  });
});

// ============================================================================
// CacheInvalidationPatterns
// ============================================================================

describe("CacheInvalidationPatterns", () => {
  describe("post patterns", () => {
    it("onCreated returns project-scoped tag and dashboard stats", () => {
      const event = makeDomainEvent({ data: { projectId: "proj-1" } });
      const tags = CacheInvalidationPatterns.post.onCreated(event);
      expect(tags).toContain("posts:proj-1");
      expect(tags).toContain("dashboard:stats");
    });

    it("onUpdated returns post-specific and project-scoped keys", () => {
      const event = makeDomainEvent({
        aggregateId: "post-1",
        data: { projectId: "proj-1" },
      });
      const keys = CacheInvalidationPatterns.post.onUpdated(event);
      expect(keys).toContain("post:post-1");
      expect(keys).toContain("post:post-1:analytics");
      expect(keys).toContain("posts:proj-1");
    });

    it("onDeleted returns post-specific and project-scoped keys", () => {
      const event = makeDomainEvent({
        aggregateId: "post-2",
        data: { projectId: "proj-2" },
      });
      const keys = CacheInvalidationPatterns.post.onDeleted(event);
      expect(keys).toContain("post:post-2");
      expect(keys).toContain("post:post-2:analytics");
      expect(keys).toContain("posts:proj-2");
    });
  });

  describe("project patterns", () => {
    it("onCreated returns projects list and dashboard stats", () => {
      const event = makeDomainEvent();
      const tags = CacheInvalidationPatterns.project.onCreated(event);
      expect(tags).toContain("projects");
      expect(tags).toContain("dashboard:stats");
    });

    it("onUpdated returns project-specific and list keys", () => {
      const event = makeDomainEvent({ aggregateId: "proj-1" });
      const keys = CacheInvalidationPatterns.project.onUpdated(event);
      expect(keys).toContain("project:proj-1");
      expect(keys).toContain("projects");
    });

    it("onDeleted returns project, posts, and list keys", () => {
      const event = makeDomainEvent({ aggregateId: "proj-1" });
      const keys = CacheInvalidationPatterns.project.onDeleted(event);
      expect(keys).toContain("project:proj-1");
      expect(keys).toContain("posts:proj-1");
      expect(keys).toContain("projects");
    });
  });

  describe("analytics patterns", () => {
    it("onCreated returns post analytics, channel analytics, and aggregated", () => {
      const event = makeDomainEvent({
        data: { postId: "post-1", channelId: "ch-1" },
      });
      const tags = CacheInvalidationPatterns.analytics.onCreated(event);
      expect(tags).toContain("post:post-1:analytics");
      expect(tags).toContain("channel:ch-1:analytics");
      expect(tags).toContain("analytics:aggregated");
    });

    it("onUpdated returns post analytics and aggregated", () => {
      const event = makeDomainEvent({ data: { postId: "post-2" } });
      const keys = CacheInvalidationPatterns.analytics.onUpdated(event);
      expect(keys).toContain("post:post-2:analytics");
      expect(keys).toContain("analytics:aggregated");
    });

    it("onDeleted returns post analytics and aggregated", () => {
      const event = makeDomainEvent({ data: { postId: "post-3" } });
      const keys = CacheInvalidationPatterns.analytics.onDeleted(event);
      expect(keys).toContain("post:post-3:analytics");
      expect(keys).toContain("analytics:aggregated");
    });
  });

  describe("user patterns", () => {
    it("onCreated returns users list", () => {
      const event = makeDomainEvent();
      const tags = CacheInvalidationPatterns.user.onCreated(event);
      expect(tags).toContain("users");
    });

    it("onUpdated returns user-specific and list keys", () => {
      const event = makeDomainEvent({ aggregateId: "user-1" });
      const keys = CacheInvalidationPatterns.user.onUpdated(event);
      expect(keys).toContain("user:user-1");
      expect(keys).toContain("users");
    });

    it("onDeleted returns user-specific and list keys", () => {
      const event = makeDomainEvent({ aggregateId: "user-2" });
      const keys = CacheInvalidationPatterns.user.onDeleted(event);
      expect(keys).toContain("user:user-2");
      expect(keys).toContain("users");
    });
  });
});

// ============================================================================
// createCacheEventManager factory
// ============================================================================

describe("createCacheEventManager", () => {
  it("creates manager with all default patterns", () => {
    const mockCache = createMockCacheManager();
    const eventManager = createCacheEventManager(mockCache);

    const events = eventManager.getRegisteredEvents();
    // Default patterns: post, project, analytics, user — each has created/updated/deleted
    expect(events.length).toBeGreaterThanOrEqual(12);
    expect(events).toContain("post.created");
    expect(events).toContain("post.updated");
    expect(events).toContain("post.deleted");
    expect(events).toContain("project.created");
    expect(events).toContain("analytics.created");
    expect(events).toContain("user.created");
  });

  it("creates manager with specific patterns only", () => {
    const mockCache = createMockCacheManager();
    const eventManager = createCacheEventManager(mockCache, ["post"]);

    const events = eventManager.getRegisteredEvents();
    expect(events).toContain("post.created");
    expect(events).toContain("post.updated");
    expect(events).toContain("post.deleted");
    expect(events).not.toContain("project.created");
  });

  it("ignores unknown pattern names", () => {
    const mockCache = createMockCacheManager();
    const eventManager = createCacheEventManager(mockCache, ["unknown-pattern"]);

    const events = eventManager.getRegisteredEvents();
    expect(events).toHaveLength(0);
  });

  it("creates manager with empty patterns array", () => {
    const mockCache = createMockCacheManager();
    const eventManager = createCacheEventManager(mockCache, []);

    const events = eventManager.getRegisteredEvents();
    expect(events).toHaveLength(0);
  });

  it("handles events correctly after creation", async () => {
    const mockCache = createMockCacheManager();
    const eventManager = createCacheEventManager(mockCache, ["post"]);

    await eventManager.handleEvent(
      makeDomainEvent({
        eventType: "post.created",
        data: { projectId: "proj-test" },
      })
    );

    expect(mockCache.invalidateByTag).toHaveBeenCalledWith("posts:proj-test");
  });
});
