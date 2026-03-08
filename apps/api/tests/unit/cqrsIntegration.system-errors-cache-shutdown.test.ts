import { describe, it, beforeEach, afterEach, before, after } from "node:test";
import assert from "node:assert/strict";
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
before(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = _originalConsoleLog;
});

describe("CQRSIntegration - System Routes", { concurrency: 1 }, () => {
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

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.status);
    assert.ok(body.metrics);
    assert.ok(body.handlers);
  });

  it("should include handler information in health check", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/health",
    });

    const body = JSON.parse(response.body);
    assert.ok(body.handlers.commands);
    assert.ok(body.handlers.queries);
    assert.ok(Array.isArray(body.handlers.commands));
    assert.ok(Array.isArray(body.handlers.queries));
  });

  it("should handle GET /api/cqrs/metrics successfully", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/metrics",
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.ok(body.data.performance);
    assert.ok(body.data.handlers);
  });

  it("should include performance metrics", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/cqrs/metrics",
    });

    const body = JSON.parse(response.body);
    const metrics = body.data.performance;

    assert.ok(typeof metrics.commandsExecuted === "number");
    assert.ok(typeof metrics.queriesExecuted === "number");
    assert.ok(typeof metrics.commandErrors === "number");
    assert.ok(typeof metrics.queryErrors === "number");
  });

  it("should handle DELETE /api/cqrs/cache successfully", async () => {
    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/cqrs/cache",
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.ok(typeof body.data.clearedCount === "number");
  });

  it("should handle DELETE /api/cqrs/cache with pattern", async () => {
    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/cqrs/cache?pattern=posts:*",
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.strictEqual(body.data.pattern, "posts:*");
  });
});

describe("CQRSIntegration - Error Handling", { concurrency: 1 }, () => {
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
    assert.ok(typeof data === "object");
    if (response.statusCode >= 400) {
      assert.ok(data.error || data.validationErrors);
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

    assert.ok(response.statusCode >= 400);
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

    assert.strictEqual(response.statusCode, 404);
  });
});

describe("CQRSIntegration - Query Caching", { concurrency: 1 }, () => {
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

    assert.strictEqual(response1.statusCode, 200);
    assert.strictEqual(response2.statusCode, 200);

    const body2 = JSON.parse(response2.body);
    assert.ok(body2.metadata.fromCache);
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
    assert.ok(keys.length >= 2);
  });
});

describe("CQRSIntegration - Shutdown", { concurrency: 1 }, () => {
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
    assert.ok(handlersBefore.commands.length > 0);

    await integration.shutdown();

    const handlersAfter = busBeforeShutdown.getHandlersInfo();
    assert.strictEqual(handlersAfter.commands.length, 0);
    assert.strictEqual(handlersAfter.queries.length, 0);
  });
});

describe("CQRSIntegration - Event Publishing", { concurrency: 1 }, () => {
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

    assert.ok(mockEventService.events.length > 0);
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

    assert.strictEqual(mockEventService2.events.length, 0);
    await fastify2.close();
  });
});
