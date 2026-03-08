import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@shared/events";
import { MockFastify, MockEventService } from "./eventIntegration.test-helpers.js";

const { EventIntegration, eventContextMiddleware } = await import(
  "../../src/events/EventIntegration"
);

describe("EventIntegration - Post Publishing with Events", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should publish post and emit POST_PUBLISHED events", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute(
      "POST",
      "/api/posts/:postId/publish",
      request,
      reply
    );

    assert.equal(result.success, true, "Should publish post successfully");
    assert.equal(result.publishedTo >= 1, true, "Should publish to at least one channel");
  });

  it("should emit USER_ACTION event for publishing", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    await mockFastify.callRoute("POST", "/api/posts/:postId/publish", request, reply);

    const publishedEvents = mockEventService.getPublishedEvents();
    const userActionEvents = publishedEvents.filter((e) => e.type === EVENT_TYPES.USER_ACTION);
    assert.equal(userActionEvents.length >= 1, true, "Should emit USER_ACTION event");
  });

  it("should handle post not found during publishing", async (t) => {
    mockFastify.prisma.post.findUnique = t.mock.fn(async () => null);

    const request: any = {
      params: { postId: "nonexistent-post" },
      user: {
        id: "user-123",
        projectId: "project-456",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const _result = await mockFastify.callRoute(
      "POST",
      "/api/posts/:postId/publish",
      request,
      reply
    );

    assert.equal(reply.status.mock.calls.length >= 1, true, "Should call reply.status");
  });
});

describe("EventIntegration - Event History Retrieval", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get event history for post", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/posts/:postId/events", request, reply);

    assert.equal(result.success, true, "Should retrieve events successfully");
    assert.ok(Array.isArray(result.events), "Should return events array");
  });

  it("should include event count in response", async (t) => {
    const request: any = {
      params: { postId: "post-123" },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/posts/:postId/events", request, reply);

    assert.equal(typeof result.eventCount, "number", "Should include event count");
  });
});

describe("EventIntegration - Analytics Events", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get analytics events", async (t) => {
    const request: any = {
      query: {},
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/analytics", request, reply);

    assert.equal(result.success, true, "Should retrieve analytics events successfully");
    assert.ok(Array.isArray(result.events), "Should return events array");
  });

  it("should support date filtering for analytics", async (t) => {
    const request: any = {
      query: {
        from: "2024-01-01T00:00:00Z",
      },
    };

    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/analytics", request, reply);

    assert.equal(result.success, true, "Should support date filtering");
    assert.ok(result.period, "Should include period in response");
  });
});

describe("EventIntegration - Health Check", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach(async (t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
    await integration.registerRoutes();
  });

  it("should get event service health status", async (t) => {
    const request: any = {};
    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/health", request, reply);

    assert.equal(result.status, "healthy", "Should report healthy status");
    assert.ok(result.statistics, "Should include statistics");
  });

  it("should include timestamp in health check", async (t) => {
    const request: any = {};
    const reply: any = {
      status: t.mock.fn(() => reply),
      send: t.mock.fn(),
    };

    const result = await mockFastify.callRoute("GET", "/api/events/health", request, reply);

    assert.ok(result.timestamp instanceof Date, "Should include timestamp");
  });
});

describe("EventIntegration - Custom Event Handlers", { concurrency: 1 }, () => {
  let integration: any;
  let mockEventService: MockEventService;
  let mockFastify: MockFastify;

  beforeEach((t: TestContext) => {
    mockEventService = new MockEventService();
    mockFastify = new MockFastify(t);
    integration = new EventIntegration(mockEventService, mockFastify as any);
  });

  it("should register POST_PUBLISHED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.POST_PUBLISHED);
    assert.ok(handlers && handlers.size >= 1, "Should register POST_PUBLISHED handler");
  });

  it("should register POST_PUBLISH_FAILED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.POST_PUBLISH_FAILED);
    assert.ok(handlers && handlers.size >= 1, "Should register POST_PUBLISH_FAILED handler");
  });

  it("should register ANALYTICS_COLLECTED handler", () => {
    integration.registerCustomHandlers();

    const handlers = mockEventService.getHandlers(EVENT_TYPES.ANALYTICS_COLLECTED);
    assert.ok(handlers && handlers.size >= 1, "Should register ANALYTICS_COLLECTED handler");
  });
});

describe("EventIntegration - Event Context Middleware", { concurrency: 1 }, () => {
  it("should add correlation ID to request", async () => {
    const request: any = {
      headers: {},
      correlationId: undefined,
      eventMetadata: undefined,
    };

    const reply: any = {};

    await eventContextMiddleware(request, reply);

    assert.ok(request.correlationId, "Should add correlation ID to request");
    assert.ok(request.eventMetadata, "Should add event metadata to request");
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

    assert.equal(request.correlationId, existingCorrelationId, "Should preserve correlation ID");
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

    assert.ok(request.eventMetadata, "Should add event metadata");
  });
});
