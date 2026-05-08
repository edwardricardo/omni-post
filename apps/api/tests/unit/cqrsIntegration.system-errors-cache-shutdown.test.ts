/**
 * @file cqrsIntegration.system-errors-cache-shutdown.test.ts
 * @description Tests for CQRSIntegration - System Routes
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, beforeAll, afterAll, expect } from "vitest";
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

let _originalConsoleLog: typeof console.log;
beforeAll(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = _originalConsoleLog;
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

    integration = new CQRSIntegration({
      fastify,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableMetrics: true,
      enableQueryCache: true,
    });

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

    integration = new CQRSIntegration({
      fastify,
      createPostUseCase: mockCreatePostUseCase as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: mockPostQueryRepository as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });

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
        body: "",
        channelIds: [],
      },
    });

    const data = response.json();
    expect(typeof data === "object").toBeTruthy();
    if (response.statusCode >= 400) {
      expect(data.error || data.validationErrors).toBeTruthy();
    }
  });

  it("should handle use case errors gracefully", async () => {
    // Override use case to simulate failure
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
    // Override query repository to return not found
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

    integration = new CQRSIntegration({
      fastify,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableQueryCache: true,
    });

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
    const integration = new CQRSIntegration({
      fastify,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });

    await integration.initialize();
    await integration.shutdown();
  });

  it("should clear handlers on shutdown", async () => {
    const integration = new CQRSIntegration({
      fastify,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });

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

    integration = new CQRSIntegration({
      fastify,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: new MockChannelRepository() as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });

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

    // Force channel validation failure by making channelRepository return not found
    const failingChannelRepo = new MockChannelRepository();
    failingChannelRepo.findById = async () => ({
      ok: false as const,
      error: { message: "Channel not found", code: "NOT_FOUND" },
    });

    // Need to create a new integration with the failing repo
    const fastify2 = Fastify({ logger: false });
    const mockEventService2 = new MockEventService();
    const integration2 = new CQRSIntegration({
      fastify: fastify2,
      createPostUseCase: new MockCreatePostUseCase() as any,
      updatePostUseCase: new MockUpdatePostUseCase() as any,
      deletePostUseCase: new MockDeletePostUseCase() as any,
      postRepository: new MockPostRepository() as any,
      channelRepository: failingChannelRepo as any,
      postQueryRepository: new MockPostQueryRepository() as any,
      eventService: mockEventService2 as any,
      redis: new MockRedis() as any,
    });
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
