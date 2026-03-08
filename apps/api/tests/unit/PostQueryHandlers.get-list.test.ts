import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GetPostQueryHandler,
  ListPostsQueryHandler,
} from "../../src/cqrs/handlers/PostQueryHandlers";
import type { Query } from "@shared/cqrs";
import {
  createMockPostQueryRepository,
  POST_QUERIES,
  VALID_POST_ID,
  VALID_PROJECT_ID,
  NON_EXISTENT_POST_ID,
  type MockPostQueryRepository,
} from "./PostQueryHandlers.test-helpers";

describe("GetPostQueryHandler - Basic Functionality", { concurrency: 1 }, () => {
  let handler: GetPostQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new GetPostQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    assert.strictEqual(handler.queryType, POST_QUERIES.GET_POST);
  });

  it("should retrieve post successfully", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.type, "PostReadModel");
  });

  it("should return error when post not found", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: NON_EXISTENT_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("not found"));
  });

  it("should include post content in read model", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: false,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
    assert.ok(result.data.data.body);
  });

  it("should return mediaUrls as empty array (domain read model has mediaCount)", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
    assert.ok(Array.isArray(result.data.data.mediaUrls));
    assert.strictEqual(result.data.data.mediaUrls.length, 0);
  });

  it("should return channels as empty array (from separate endpoints)", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
    assert.ok(Array.isArray(result.data.data.channels));
    assert.strictEqual(result.data.data.channels.length, 0);
  });

  it("should transform domain read model to CQRS envelope", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: true,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);

    const readModel = result.data;
    assert.ok(readModel.id.startsWith("post-readmodel-"));
    assert.strictEqual(readModel.type, "PostReadModel");
    assert.strictEqual(readModel.version, 1);
    assert.ok(readModel.lastUpdated);
    assert.ok(readModel.data);
    assert.ok(readModel.data.id);
    assert.ok(readModel.data.projectId);
    assert.ok(readModel.data.body);
    assert.ok(readModel.data.locale);
  });

  it("should return error for invalid UUID", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: "not-a-uuid",
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Invalid post ID"));
  });

  it("should handle repository errors gracefully", async () => {
    mockRepo.getById = async () => {
      throw new Error("Repository error");
    };

    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        postId: VALID_POST_ID,
        includeContent: true,
        includeMedia: true,
        includeAnalytics: false,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});

describe("ListPostsQueryHandler - Basic Functionality", { concurrency: 1 }, () => {
  let handler: ListPostsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new ListPostsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    assert.strictEqual(handler.queryType, POST_QUERIES.LIST_POSTS);
  });

  it("should list posts successfully", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.type, "PostsListReadModel");
  });

  it("should include pagination metadata", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.metadata);
    assert.ok(typeof result.metadata.totalCount === "number");
    assert.ok(typeof result.metadata.page === "number");
    assert.ok(typeof result.metadata.limit === "number");
  });

  it("should accept status filter", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        status: "PUBLISHED",
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);
  });

  it("should accept channel filter", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        channelId: "channel-1",
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
  });

  it("should accept date range filter", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        fromDate: new Date("2024-01-01"),
        toDate: new Date("2024-12-31"),
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
  });

  it("should accept tags filter", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        tags: ["tag1", "tag2"],
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
  });

  it("should support different sort orders", async () => {
    const sortOrders = ["ASC", "DESC"] as const;

    for (const sortOrder of sortOrders) {
      const query: Query = {
        id: `qry-${sortOrder}`,
        type: POST_QUERIES.LIST_POSTS,
        data: {
          projectId: VALID_PROJECT_ID,
          limit: 20,
          offset: 0,
          sortBy: "createdAt",
          sortOrder,
        },
        metadata: {
          correlationId: "corr-1",
          source: "test",
        },
        timestamp: new Date(),
      };

      const result = await handler.handle(query);
      assert.ok(result.success);
    }
  });

  it("should support different sort fields", async () => {
    const sortFields = ["createdAt", "updatedAt", "scheduledAt"] as const;

    for (const sortBy of sortFields) {
      const query: Query = {
        id: `qry-${sortBy}`,
        type: POST_QUERIES.LIST_POSTS,
        data: {
          projectId: VALID_PROJECT_ID,
          limit: 20,
          offset: 0,
          sortBy,
          sortOrder: "DESC",
        },
        metadata: {
          correlationId: "corr-1",
          source: "test",
        },
        timestamp: new Date(),
      };

      const result = await handler.handle(query);
      assert.ok(result.success);
    }
  });

  it("should include channel counts in results", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);

    const posts = result.data.data.posts;
    assert.ok(posts.length > 0);
    const firstPost = posts[0];
    assert.ok(firstPost);
    assert.ok(typeof firstPost.channelCount === "number");
    assert.ok(typeof firstPost.publishedChannels === "number");
    assert.ok(typeof firstPost.failedChannels === "number");
  });

  it("should include hasMedia based on mediaCount", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.ok(result.success);
    assert.ok(result.data);

    const posts = result.data.data.posts;
    // First post has mediaCount: 1, second has mediaCount: 0
    const firstPost = posts[0];
    const secondPost = posts[1];
    assert.ok(firstPost);
    assert.ok(secondPost);
    assert.strictEqual(firstPost.hasMedia, true);
    assert.strictEqual(secondPost.hasMedia, false);
  });

  it("should return error for invalid project UUID", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: "not-a-uuid",
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Invalid project ID"));
  });

  it("should handle repository errors gracefully", async () => {
    mockRepo.listByProject = async () => {
      throw new Error("Repository error");
    };

    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        limit: 20,
        offset: 0,
        sortBy: "createdAt",
        sortOrder: "DESC",
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});
