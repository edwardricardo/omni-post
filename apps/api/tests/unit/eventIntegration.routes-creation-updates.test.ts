import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@shared/events";
import { MockFastify, MockEventService } from "./eventIntegration.test-helpers.js";

const { EventIntegration } = await import("../../src/events/EventIntegration");

describe("EventIntegration - Route Registration", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach((t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
  });

  it("should register event-aware API routes", async () => {
    await integration.registerRoutes();

    assert.equal(
      mockFastify.hasRoute("POST", "/api/posts/events"),
      true,
      "Should register POST /api/posts/events"
    );
    assert.equal(
      mockFastify.hasRoute("PUT", "/api/posts/:postId/events"),
      true,
      "Should register PUT /api/posts/:postId/events"
    );
    assert.equal(
      mockFastify.hasRoute("POST", "/api/posts/:postId/publish"),
      true,
      "Should register POST /api/posts/:postId/publish"
    );
    assert.equal(
      mockFastify.hasRoute("GET", "/api/posts/:postId/events"),
      true,
      "Should register GET /api/posts/:postId/events"
    );
  });

  it("should register analytics event route", async () => {
    await integration.registerRoutes();

    assert.equal(
      mockFastify.hasRoute("GET", "/api/events/analytics"),
      true,
      "Should register GET /api/events/analytics"
    );
  });

  it("should register health check route", async () => {
    await integration.registerRoutes();

    assert.equal(
      mockFastify.hasRoute("GET", "/api/events/health"),
      true,
      "Should register GET /api/events/health"
    );
  });
});

describe("EventIntegration - Post Creation with Events", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should create post and emit POST_CREATED event", async (t) => {
    const request: any = {
      body: {
        title: "Test Post",
        body: "Test content",
        channelIds: ["channel-1", "channel-2"],
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    assert.equal(result.success, true, "Should create post successfully");
    assert.equal(result.data.id, "post-123", "Should return created post");

    const publishedEvents = mockEventService.getPublishedEvents();
    const postCreatedEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_CREATED);
    assert.equal(postCreatedEvents.length >= 1, true, "Should emit POST_CREATED event");
  });

  it("should emit USER_ACTION event for post creation", async (t) => {
    const request: any = {
      body: {
        title: "Test Post",
        body: "Test content",
        channelIds: ["channel-1"],
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    assert.equal(userActionEvents.length >= 1, true, "Should emit USER_ACTION event");
  });

  it("should emit POST_SCHEDULED event for scheduled posts", async (t) => {
    const scheduledAt = new Date("2025-12-01T10:00:00Z");
    const request: any = {
      body: {
        title: "Scheduled Post",
        body: "Future content",
        scheduledAt: scheduledAt.toISOString(),
        channelIds: ["channel-1"],
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    assert.equal(result.events.scheduled, true, "Should indicate post was scheduled");

    const publishedEvents = mockEventService.getPublishedEvents();
    const scheduledEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_SCHEDULED);
    assert.equal(scheduledEvents.length >= 1, true, "Should emit POST_SCHEDULED event");
  });

  it("should handle post creation failures", async (t) => {
    mockEventService.setFailPublish(true);

    const request: any = {
      body: {
        title: "Test Post",
        body: "Test content",
        channelIds: ["channel-1"],
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    await assert.rejects(
      async () => await mockFastify.callRoute("POST", "/api/posts/events", request, reply),
      { message: /Failed to publish event/ },
      "Should throw error on event publish failure"
    );
  });
});

describe("EventIntegration - Post Updates with Events", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should update post and emit POST_UPDATED event", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
      body: {
        status: "PUBLISHED",
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    assert.equal(result.success, true, "Should update post successfully");

    const publishedEvents = mockEventService.getPublishedEvents();
    const updatedEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_UPDATED);
    assert.equal(updatedEvents.length >= 1, true, "Should emit POST_UPDATED event");
  });

  it("should track changes in POST_UPDATED event", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
      body: {
        status: "PUBLISHED",
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    assert.ok(Array.isArray(result.changes), "Should include changes in response");
  });

  it("should emit USER_ACTION event for post update", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
      body: {
        status: "PUBLISHED",
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    assert.equal(userActionEvents.length >= 1, true, "Should emit USER_ACTION event");
  });

  it("should handle post not found", async (t) => {
    mockFastify.prisma.post.findUnique = t.mock.fn(async () => null);

    const request: any = {
      params: { postId: "nonexistent-post" },
      body: {
        status: "PUBLISHED",
      },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const _result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    assert.equal(reply.status.mock.calls.length >= 1, true, "Should call reply.status");
    const statusCall = reply.status.mock.calls[0];
    assert.equal(statusCall.arguments[0], 404, "Should return 404 status");
  });
});
