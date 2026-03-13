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
      enableMetrics: true,
      enableQueryCache: true,
    });

    await integration.initialize();

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.commands.length > 0).toBeTruthy();
    expect(handlers.queries.length > 0).toBeTruthy();
  });

  it("should register command handlers during initialization", async () => {
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

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.commands.includes("post.create")).toBeTruthy();
    expect(handlers.commands.includes("post.update")).toBeTruthy();
    expect(handlers.commands.includes("post.publish")).toBeTruthy();
  });

  it("should register query handlers during initialization", async () => {
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

    const bus = integration.getBus();
    const handlers = bus.getHandlersInfo();

    expect(handlers.queries.includes("post.get")).toBeTruthy();
    expect(handlers.queries.includes("post.list")).toBeTruthy();
    expect(handlers.queries.includes("post.search")).toBeTruthy();
  });

  it("should use default configuration when not provided", async () => {
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
