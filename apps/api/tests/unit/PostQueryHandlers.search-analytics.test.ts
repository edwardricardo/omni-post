/**
 * @file PostQueryHandlers.search-analytics.test.ts
 * @description Tests for SearchPostsQueryHandler - Basic Functionality
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import {
  SearchPostsQueryHandler,
  GetPostAnalyticsQueryHandler,
} from "../../src/cqrs/handlers/PostQueryHandlers.js";
import type { Query } from "@shared/types/cqrs.js";
import {
  createMockPostQueryRepository,
  POST_QUERIES,
  VALID_POST_ID,
  VALID_PROJECT_ID,
  NON_EXISTENT_POST_ID,
  type MockPostQueryRepository,
} from "./PostQueryHandlers.test-helpers.js";

describe("SearchPostsQueryHandler - Basic Functionality", () => {
  let handler: SearchPostsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new SearchPostsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    expect(handler.queryType).toBe(POST_QUERIES.SEARCH_POSTS);
  });

  it("should search posts successfully", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        limit: 10,
        offset: 0,
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

  it("should search with status filters", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        filters: {
          status: ["PUBLISHED", "SCHEDULED"],
        },
        limit: 10,
        offset: 0,
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

  it("should search with channel filters", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        filters: {
          channelIds: ["channel-1", "channel-2"],
        },
        limit: 10,
        offset: 0,
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

  it("should search with tag filters", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        filters: {
          tags: ["tag1", "tag2"],
        },
        limit: 10,
        offset: 0,
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

  it("should search with date range filter", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        filters: {
          dateRange: {
            from: new Date("2024-01-01"),
            to: new Date("2024-12-31"),
          },
        },
        limit: 10,
        offset: 0,
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

  it("should search with combined filters", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        filters: {
          status: ["PUBLISHED"],
          channelIds: ["channel-1"],
          tags: ["tag1"],
          dateRange: {
            from: new Date("2024-01-01"),
            to: new Date("2024-12-31"),
          },
        },
        limit: 10,
        offset: 0,
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

  it("should include search metadata", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test query",
        limit: 10,
        offset: 0,
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
    expect(result.metadata.totalCount !== undefined).toBeTruthy();
  });

  it("should include searchTerm in filters", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test query",
        limit: 10,
        offset: 0,
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
    expect((result.data.data.filters as Record<string, unknown>).searchTerm).toBe("test query");
  });

  it("should return error for invalid project UUID", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: "not-a-uuid",
        searchTerm: "test",
        limit: 10,
        offset: 0,
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
    mockRepo.search = async () => {
      throw new Error("Repository error");
    };

    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        projectId: VALID_PROJECT_ID,
        searchTerm: "test",
        limit: 10,
        offset: 0,
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

describe("GetPostAnalyticsQueryHandler - Basic Functionality", () => {
  let handler: GetPostAnalyticsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new GetPostAnalyticsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    expect(handler.queryType).toBe(POST_QUERIES.GET_POST_ANALYTICS);
  });

  it("should retrieve analytics read model successfully", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: VALID_POST_ID,
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
    expect(result.data.type).toBe("PostAnalyticsReadModel");
  });

  it("should return error when post not found", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: NON_EXISTENT_POST_ID,
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

  it("should return channels as empty array (analytics from separate endpoints)", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: VALID_POST_ID,
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

  it("should include zeroed aggregated analytics", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: VALID_POST_ID,
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

    const aggregated = result.data.data.aggregated;
    expect(typeof aggregated.totalViews === "number").toBeTruthy();
    expect(typeof aggregated.totalLikes === "number").toBeTruthy();
    expect(typeof aggregated.totalShares === "number").toBeTruthy();
    expect(typeof aggregated.totalComments === "number").toBeTruthy();
    expect(typeof aggregated.engagementRate === "number").toBeTruthy();
    expect(aggregated.totalViews).toBe(0);
    expect(aggregated.totalLikes).toBe(0);
    expect(aggregated.engagementRate).toBe(0);
  });

  it("should include empty trends array", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: VALID_POST_ID,
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
    expect(Array.isArray(result.data.data.trends)).toBeTruthy();
    expect(result.data.data.trends.length).toBe(0);
  });

  it("should return error for missing postId", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {},
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await handler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error?.includes("required")).toBeTruthy();
  });

  it("should return error for invalid UUID", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: "not-a-uuid",
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
      type: POST_QUERIES.GET_POST_ANALYTICS,
      data: {
        postId: VALID_POST_ID,
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
