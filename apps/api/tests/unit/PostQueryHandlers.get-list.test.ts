/**
 * @file PostQueryHandlers.get-list.test.ts
 * @description Tests for GetPostQueryHandler - Basic Functionality
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
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

describe("GetPostQueryHandler - Basic Functionality", () => {
  let handler: GetPostQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new GetPostQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    expect(handler.queryType).toBe(POST_QUERIES.GET_POST);
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.type).toBe("PostReadModel");
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

    expect(result.success).toBe(false);
    expect(result.error?.includes("not found")).toBeTruthy();
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.data.body).toBeTruthy();
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(Array.isArray(result.data.data.mediaUrls)).toBeTruthy();
    expect(result.data.data.mediaUrls.length).toBe(0);
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(Array.isArray(result.data.data.channels)).toBeTruthy();
    expect(result.data.data.channels.length).toBe(0);
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();

    const readModel = result.data;
    expect(readModel.id.startsWith("post-readmodel-")).toBeTruthy();
    expect(readModel.type).toBe("PostReadModel");
    expect(readModel.version).toBe(1);
    expect(readModel.lastUpdated).toBeTruthy();
    expect(readModel.data).toBeTruthy();
    expect(readModel.data.id).toBeTruthy();
    expect(readModel.data.projectId).toBeTruthy();
    expect(readModel.data.body).toBeTruthy();
    expect(readModel.data.locale).toBeTruthy();
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

    expect(result.success).toBe(false);
    expect(result.error?.includes("Invalid post ID")).toBeTruthy();
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

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("ListPostsQueryHandler - Basic Functionality", () => {
  let handler: ListPostsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new ListPostsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    expect(handler.queryType).toBe(POST_QUERIES.LIST_POSTS);
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
    expect(result.data.type).toBe("PostsListReadModel");
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

    expect(result.success).toBeTruthy();
    expect(result.metadata).toBeTruthy();
    expect(typeof result.metadata.totalCount === "number").toBeTruthy();
    expect(typeof result.metadata.page === "number").toBeTruthy();
    expect(typeof result.metadata.limit === "number").toBeTruthy();
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();
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

    expect(result.success).toBeTruthy();
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

    expect(result.success).toBeTruthy();
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

    expect(result.success).toBeTruthy();
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
      expect(result.success).toBeTruthy();
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
      expect(result.success).toBeTruthy();
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();

    const posts = result.data.data.posts;
    expect(posts.length > 0).toBeTruthy();
    const firstPost = posts[0];
    expect(firstPost).toBeTruthy();
    expect(typeof firstPost.channelCount === "number").toBeTruthy();
    expect(typeof firstPost.publishedChannels === "number").toBeTruthy();
    expect(typeof firstPost.failedChannels === "number").toBeTruthy();
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

    expect(result.success).toBeTruthy();
    expect(result.data).toBeTruthy();

    const posts = result.data.data.posts;
    // First post has mediaCount: 1, second has mediaCount: 0
    const firstPost = posts[0];
    const secondPost = posts[1];
    expect(firstPost).toBeTruthy();
    expect(secondPost).toBeTruthy();
    expect(firstPost.hasMedia).toBe(true);
    expect(secondPost.hasMedia).toBe(false);
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

    expect(result.success).toBe(false);
    expect(result.error?.includes("Invalid project ID")).toBeTruthy();
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

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
