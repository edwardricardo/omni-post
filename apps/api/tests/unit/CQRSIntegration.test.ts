/**
 * Unit Tests for CQRSIntegration - Fastify Integration Layer
 *
 * Test Coverage:
 * - CQRS initialization with Fastify
 * - Command and query handler registration
 * - API route registration and behavior
 * - Request/response handling
 * - Error handling and validation
 * - Cache management endpoints
 * - Health check and metrics endpoints
 * - Graceful shutdown
 *
 * @file CQRSIntegration.test.ts
 * @description Tests for CQRSIntegration - Initialization
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { CQRSIntegration } from "../../src/cqrs/CQRSIntegration";
import {
  MockRedis,
  MockEventService,
  MockCreatePostUseCase,
  MockUpdatePostUseCase,
  MockDeletePostUseCase,
  MockPostRepository,
  MockChannelRepository,
  MockPostQueryRepository,
  TEST_POST_ID,
  TEST_CHANNEL_ID,
} from "./cqrsIntegration.test-helpers.js";

// ---------------------------------------------------------------------------
// Helper to build CQRSIntegration config
// ---------------------------------------------------------------------------

function buildConfig(
  fastify: FastifyInstance,
  overrides?: {
    redis?: MockRedis;
    eventService?: MockEventService;
    createPostUseCase?: MockCreatePostUseCase;
    postQueryRepository?: MockPostQueryRepository;
    channelRepository?: MockChannelRepository;
    enableMetrics?: boolean;
    enableQueryCache?: boolean;
  }
) {
  return {
    fastify,
    createPostUseCase: (overrides?.createPostUseCase ?? new MockCreatePostUseCase()) as any,
    updatePostUseCase: new MockUpdatePostUseCase() as any,
    deletePostUseCase: new MockDeletePostUseCase() as any,
    postRepository: new MockPostRepository() as any,
    channelRepository: (overrides?.channelRepository ?? new MockChannelRepository()) as any,
    postQueryRepository: (overrides?.postQueryRepository ?? new MockPostQueryRepository()) as any,
    eventService: (overrides?.eventService ?? new MockEventService()) as any,
    redis: (overrides?.redis ?? new MockRedis()) as any,
    ...(overrides?.enableMetrics !== undefined && { enableMetrics: overrides.enableMetrics }),
    ...(overrides?.enableQueryCache !== undefined && {
      enableQueryCache: overrides.enableQueryCache,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CQRSIntegration - Initialization", () => {
  let fastify: FastifyInstance;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should initialize CQRS integration successfully", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        enableMetrics: true,
        enableQueryCache: true,
      })
    );

    await integration.initialize();

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.commands.length > 0).toBeTruthy();
    expect(handlers.queries.length > 0).toBeTruthy();
  });

  it("should register command handlers during initialization", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.commands.includes("post.create")).toBeTruthy();
    expect(handlers.commands.includes("post.update")).toBeTruthy();
    expect(handlers.commands.includes("post.publish")).toBeTruthy();
  });

  it("should register query handlers during initialization", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.queries.includes("post.get")).toBeTruthy();
    expect(handlers.queries.includes("post.list")).toBeTruthy();
    expect(handlers.queries.includes("post.search")).toBeTruthy();
  });

  it("should use default configuration when not provided", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();

    const bus = integration.getBus();
    expect(bus).toBeTruthy();
  });
});

describe("CQRSIntegration - Command Routes", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        enableMetrics: true,
        enableQueryCache: true,
      })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should handle POST /api/cqrs/posts/create successfully", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        body: "Test post content",
        locale: "en",
        channelIds: [TEST_CHANNEL_ID],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(body.data.postId).toBeTruthy();
  });

  it("should handle POST /api/cqrs/posts/create with optional fields", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        title: "Test Title",
        body: "Test post content",
        locale: "en",
        tags: ["test", "cqrs"],
        mediaIds: ["media-1"],
        scheduledAt: new Date().toISOString(),
        channelIds: [TEST_CHANNEL_ID],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should handle PUT /api/cqrs/posts/:postId successfully", async () => {
    const response = await fastify.inject({
      method: "PUT",
      url: `/api/cqrs/posts/${TEST_POST_ID}`,
      payload: {
        title: "Updated Title",
        body: "Updated content",
        tags: ["updated"],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should handle POST /api/cqrs/posts/:postId/publish successfully", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: `/api/cqrs/posts/${TEST_POST_ID}/publish`,
      payload: {
        channelIds: [TEST_CHANNEL_ID],
        priority: "NORMAL",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should handle publish with scheduled time", async () => {
    const publishAt = new Date(Date.now() + 3600000);

    const response = await fastify.inject({
      method: "POST",
      url: `/api/cqrs/posts/${TEST_POST_ID}/publish`,
      payload: {
        channelIds: [TEST_CHANNEL_ID],
        publishAt: publishAt.toISOString(),
        priority: "HIGH",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should return error for invalid command data", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        locale: "en",
      },
    });

    expect(response.statusCode >= 400).toBeTruthy();
  });
});

describe("CQRSIntegration - Query Routes", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        enableMetrics: true,
        enableQueryCache: true,
      })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should handle GET /api/cqrs/posts/:postId successfully", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(body.data).toBeTruthy();
  });

  it("should handle GET /api/cqrs/posts/:postId with query parameters", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}?includeContent=true&includeMedia=true&includeAnalytics=true`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(body.metadata).toBeTruthy();
  });

  it("should handle GET /api/cqrs/posts with filters", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts?projectId=b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3&status=PUBLISHED&limit=10",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should handle GET /api/cqrs/posts with pagination", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts?projectId=b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3&limit=20&offset=0&sortBy=createdAt&sortOrder=DESC",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should handle GET /api/cqrs/posts/search successfully", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts/search?projectId=b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3&q=test",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });

  it("should return error for search without search term", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts/search?projectId=b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3",
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeTruthy();
  });

  it("should handle search with filters", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts/search?projectId=b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3&q=test&status=PUBLISHED&tags=tag1,tag2",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
  });
});

describe("CQRSIntegration - System Routes", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        enableMetrics: true,
        enableQueryCache: true,
      })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should handle GET /api/cqrs/health successfully", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBeTruthy();
    expect(body.metrics).toBeTruthy();
    expect(body.handlers).toBeTruthy();
  });

  it("should include handler information in health check", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/health",
    });

    const body = JSON.parse(response.body);
    expect(body.handlers.commands).toBeTruthy();
    expect(body.handlers.queries).toBeTruthy();
    expect(Array.isArray(body.handlers.commands)).toBeTruthy();
    expect(Array.isArray(body.handlers.queries)).toBeTruthy();
  });

  it("should handle GET /api/cqrs/metrics successfully", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/metrics",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(body.data.performance).toBeTruthy();
    expect(body.data.handlers).toBeTruthy();
  });

  it("should include performance metrics", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/metrics",
    });

    const body = JSON.parse(response.body);
    const metrics = body.data.performance;

    expect(typeof metrics.commandsExecuted === "number").toBeTruthy();
    expect(typeof metrics.queriesExecuted === "number").toBeTruthy();
    expect(typeof metrics.commandErrors === "number").toBeTruthy();
    expect(typeof metrics.queryErrors === "number").toBeTruthy();
  });

  it("should handle DELETE /api/cqrs/cache successfully", async () => {
    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/cqrs/cache",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(typeof body.data.clearedCount === "number").toBeTruthy();
  });

  it("should handle DELETE /api/cqrs/cache with pattern", async () => {
    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/cqrs/cache?pattern=posts:*",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBeTruthy();
    expect(body.data.pattern).toBe("posts:*");
  });
});

describe("CQRSIntegration - Error Handling", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;
  let mockCreatePostUseCase: MockCreatePostUseCase;
  let mockPostQueryRepository: MockPostQueryRepository;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    mockCreatePostUseCase = new MockCreatePostUseCase();
    mockPostQueryRepository = new MockPostQueryRepository();

    integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        createPostUseCase: mockCreatePostUseCase,
        postQueryRepository: mockPostQueryRepository,
      })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should handle validation errors in create command", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        channelIds: "not-an-array",
        body: 12345,
      },
    });

    expect(response.statusCode >= 400).toBeTruthy();
  });

  it("should handle use case errors gracefully", async () => {
    mockCreatePostUseCase.execute = async () => ({
      ok: false as const,
      error: { message: "Database error", code: "INTERNAL_ERROR" },
    });

    const response = await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        body: "Test content",
        channelIds: [TEST_CHANNEL_ID],
      },
    });

    expect(response.statusCode >= 400).toBeTruthy();
  });

  it("should handle non-existent post queries", async () => {
    mockPostQueryRepository.getById = async () => ({
      ok: false as const,
      error: { message: "Post not found", code: "NOT_FOUND" },
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/posts/00000000-0000-4000-a000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("CQRSIntegration - Query Caching", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    integration = new CQRSIntegration(
      buildConfig(fastify, {
        redis: mockRedis,
        eventService: mockEventService,
        enableQueryCache: true,
      })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should cache query results", async () => {
    const response1 = await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}`,
    });

    const response2 = await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}`,
    });

    expect(response1.statusCode).toBe(200);
    expect(response2.statusCode).toBe(200);

    const body2 = JSON.parse(response2.body);
    expect(body2.metadata.fromCache).toBeTruthy();
  });

  it("should generate unique cache keys for different queries", async () => {
    await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}?includeContent=true`,
    });

    await fastify.inject({
      method: "GET",
      url: `/api/cqrs/posts/${TEST_POST_ID}?includeContent=false`,
    });

    const keys = await mockRedis.keys("cqrs:query:*");
    expect(keys.length >= 2).toBeTruthy();
  });
});

describe("CQRSIntegration - Shutdown", () => {
  let fastify: FastifyInstance;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should shutdown gracefully", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();
    await integration.shutdown();
  });

  it("should clear handlers on shutdown", async () => {
    const integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();

    const busBeforeShutdown = integration.getBus();
    const handlersBefore = busBeforeShutdown.getHandlersInfo();
    expect(handlersBefore.commands.length > 0).toBeTruthy();

    await integration.shutdown();

    const handlersAfter = busBeforeShutdown.getHandlersInfo();
    expect(handlersAfter.commands.length).toBe(0);
    expect(handlersAfter.queries.length).toBe(0);
  });
});

describe("CQRSIntegration - Event Publishing", () => {
  let fastify: FastifyInstance;
  let integration: CQRSIntegration;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    integration = new CQRSIntegration(
      buildConfig(fastify, { redis: mockRedis, eventService: mockEventService })
    );

    await integration.initialize();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("should publish events after successful command", async () => {
    await fastify.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        body: "Test post",
        channelIds: [TEST_CHANNEL_ID],
      },
    });

    expect(mockEventService.events.length > 0).toBeTruthy();
  });

  it("should not publish events if command fails", async () => {
    mockEventService.reset();

    const fastify2 = Fastify({ logger: false });
    const mockEventService2 = new MockEventService();
    const failingChannelRepo = new MockChannelRepository();
    failingChannelRepo.findById = async () => ({
      ok: false as const,
      error: { message: "Channel not found", code: "NOT_FOUND" },
    });

    const integration2 = new CQRSIntegration(
      buildConfig(fastify2, {
        eventService: mockEventService2,
        channelRepository: failingChannelRepo,
      })
    );
    await integration2.initialize();

    await fastify2.inject({
      method: "POST",
      url: "/api/cqrs/posts/create",
      payload: {
        body: "Test post",
        channelIds: [TEST_CHANNEL_ID],
      },
    });

    expect(mockEventService2.events.length).toBe(0);
    await fastify2.close();
  });
});
