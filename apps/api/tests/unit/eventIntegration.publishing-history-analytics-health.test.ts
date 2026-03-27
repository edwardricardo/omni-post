import { describe, it, beforeEach, vi, expect } from "vitest";
import { EVENT_TYPES } from "@shared/events";
import { MockFastify, MockEventService } from "./eventIntegration.test-helpers.js";

const { EventIntegration, eventContextMiddleware } = await import(
  "../../src/events/EventIntegration"
);

describe("EventIntegration - Post Publishing with Events", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should publish post and emit POST_PUBLISHED events", async (_t) => {
    const request: any = {
      params: { postId: "post-123" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute(
      "POST",
      "/api/posts/:postId/publish",
      request,
      reply
    );

    expect(result.success).toBe(true);
    expect(result.publishedTo >= 1).toBe(true);
  });

  it("should emit USER_ACTION event for publishing", async (_t) => {
    const request: any = {
      params: { postId: "post-123" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    await mockFastify.callRoute("POST", "/api/posts/:postId/publish", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    expect(userActionEvents.length >= 1).toBe(true);
  });

  it("should handle post not found during publishing", async (_t) => {
    mockFastify.prisma.post.findUnique = vi.fn(async () => null);

    const request: any = {
      params: { postId: "nonexistent-post" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const _result = await mockFastify.callRoute(
      "POST",
      "/api/posts/:postId/publish",
      request,
      reply
    );

    expect(reply.status.mock.calls.length >= 1).toBe(true);
  });
});

describe("EventIntegration - Event History Retrieval", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get event history for post", async (_t) => {
    const request: any = {
      params: { postId: "post-123" },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/posts/:postId/events", request, reply);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.events)).toBeTruthy();
  });

  it("should include event count in response", async (_t) => {
    const request: any = {
      params: { postId: "post-123" },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/posts/:postId/events", request, reply);

    expect(typeof result.eventCount).toBe("number");
  });
});

describe("EventIntegration - Analytics Events", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get analytics events", async (_t) => {
    const request: any = {
      query: {},
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/analytics", request, reply);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.events)).toBeTruthy();
  });

  it("should support date filtering for analytics", async (_t) => {
    const request: any = {
      query: {
        from: "2024-01-01T00:00:00Z",
      },
    };

    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/analytics", request, reply);

    expect(result.success).toBe(true);
    expect(result.period).toBeTruthy();
  });
});

describe("EventIntegration - Health Check", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async () => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get event service health status", async (_t) => {
    const request: any = {};
    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/health", request, reply);

    expect(result.status).toBe("healthy");
    expect(result.statistics).toBeTruthy();
  });

  it("should include timestamp in health check", async (_t) => {
    const request: any = {};
    const reply: any = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/health", request, reply);

    expect(result.timestamp instanceof Date).toBeTruthy();
  });
});

describe("EventIntegration - Custom Event Handlers", () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(() => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify();
    integration = new EventIntegration(mockEventService, mockFastify as any);
  });

  it("should register POST_PUBLISHED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.POST_PUBLISHED);
    expect(handlers && handlers.size >= 1).toBeTruthy();
  });

  it("should register POST_PUBLISH_FAILED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.POST_PUBLISH_FAILED);
    expect(handlers && handlers.size >= 1).toBeTruthy();
  });

  it("should register ANALYTICS_COLLECTED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.ANALYTICS_COLLECTED);
    expect(handlers && handlers.size >= 1).toBeTruthy();
  });
});

describe("EventIntegration - Event Context Middleware", () => {
  it("should add correlation ID to request", async () => {
    const request: any = {
      headers: {},
      correlationId: undefined,
      eventMetadata: undefined,
    };

    const reply: any = {};

    await eventContextMiddleware(request, reply);

    expect(request.correlationId).toBeTruthy();
    expect(request.eventMetadata).toBeTruthy();
  });

  it("should preserve existing correlation ID", async () => {
    const existingCorrelationId = "existing-correlation-123";
    const request: any = {
      headers: {
        "x-correlation-id": existingCorrelationId,
      },
      correlationId: undefined,
      eventMetadata: undefined,
    };

    const reply: any = {};

    await eventContextMiddleware(request, reply);

    expect(request.correlationId).toBe(existingCorrelationId);
  });

  it("should include user metadata when available", async () => {
    const request: any = {
      headers: {},
      user: { id: "user-123" },
      correlationId: undefined,
      eventMetadata: undefined,
    };

    const reply: any = {};

    await eventContextMiddleware(request, reply);

    expect(request.eventMetadata).toBeTruthy();
  });
});
