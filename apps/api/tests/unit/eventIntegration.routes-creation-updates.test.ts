import { describe, it, beforeEach, vi, expect } from "vitest";
import { EVENT_TYPES } from "@shared/events";
import { MockFastify, MockEventService } from "./eventIntegration.test-helpers.js";

const { EventIntegration } = await import("../../src/events/EventIntegration");

describe("EventIntegration - Route Registration", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(() => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
  });

  it("should register event-aware API routes", async () => {
    await integration.registerRoutes();

    expect(mockFastify.hasRoute("POST", "/api/posts/events")).toBe(true);
    expect(mockFastify.hasRoute("PUT", "/api/posts/:postId/events")).toBe(true);
    expect(mockFastify.hasRoute("POST", "/api/posts/:postId/publish")).toBe(true);
    expect(mockFastify.hasRoute("GET", "/api/posts/:postId/events")).toBe(true);
  });

  it("should register analytics event route", async () => {
    await integration.registerRoutes();

    expect(mockFastify.hasRoute("GET", "/api/events/analytics")).toBe(true);
  });

  it("should register health check route", async () => {
    await integration.registerRoutes();

    expect(mockFastify.hasRoute("GET", "/api/events/health")).toBe(true);
  });
});

describe("EventIntegration - Post Creation with Events", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("post-123");

    const publishedEvents = mockEventService.getPublishedEvents();
    const postCreatedEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_CREATED);
    expect(postCreatedEvents.length >= 1).toBe(true);
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    expect(userActionEvents.length >= 1).toBe(true);
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("POST", "/api/posts/events", request, reply);

    expect(result.events.scheduled).toBe(true);

    const publishedEvents = mockEventService.getPublishedEvents();
    const scheduledEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_SCHEDULED);
    expect(scheduledEvents.length >= 1).toBe(true);
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    await expect(
      mockFastify.callRoute("POST", "/api/posts/events", request, reply)
    ).rejects.toThrow(/Failed to publish event/);
  });
});

describe("EventIntegration - Post Updates with Events", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    expect(result.success).toBe(true);

    const publishedEvents = mockEventService.getPublishedEvents();
    const updatedEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.POST_UPDATED);
    expect(updatedEvents.length >= 1).toBe(true);
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    expect(Array.isArray(result.changes)).toBeTruthy();
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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    expect(userActionEvents.length >= 1).toBe(true);
  });

  it("should handle post not found", async (t) => {
    mockFastify.prisma.post.findUnique = vi.fn(async () => null);

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
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const _result = await mockFastify.callRoute("PUT", "/api/posts/:postId/events", request, reply);

    expect(reply.status.mock.calls.length >= 1).toBe(true);
    const statusCall = reply.status.mock.calls[0];
    expect(statusCall[0]).toBe(404);
  });
});
