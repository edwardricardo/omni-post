import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SearchPostsQueryHandler,
  GetPostAnalyticsQueryHandler,
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

describe("SearchPostsQueryHandler - Basic Functionality", { concurrency: 1 }, () => {
  let handler: SearchPostsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new SearchPostsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    assert.strictEqual(handler.queryType, POST_QUERIES.SEARCH_POSTS);
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

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.type, "PostsListReadModel");
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

    assert.ok(result.success);
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

    assert.ok(result.success);
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

    assert.ok(result.success);
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

    assert.ok(result.success);
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

    assert.ok(result.success);
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

    assert.ok(result.success);
    assert.ok(result.metadata);
    assert.ok(result.metadata.totalCount !== undefined);
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

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(
      (result.data.data.filters as Record<string, unknown>).searchTerm,
      "test query"
    );
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Invalid project ID"));
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});

describe("GetPostAnalyticsQueryHandler - Basic Functionality", { concurrency: 1 }, () => {
  let handler: GetPostAnalyticsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();
    handler = new GetPostAnalyticsQueryHandler({
      postQueryRepository: mockRepo,
    });
  });

  it("should have correct query type", () => {
    assert.strictEqual(handler.queryType, POST_QUERIES.GET_POST_ANALYTICS);
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

    assert.ok(result.success);
    assert.ok(result.data);
    assert.strictEqual(result.data.type, "PostAnalyticsReadModel");
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("not found"));
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

    assert.ok(result.success);
    assert.ok(result.data);
    assert.ok(Array.isArray(result.data.data.channels));
    assert.strictEqual(result.data.data.channels.length, 0);
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

    assert.ok(result.success);
    assert.ok(result.data);

    const aggregated = result.data.data.aggregated;
    assert.ok(typeof aggregated.totalViews === "number");
    assert.ok(typeof aggregated.totalLikes === "number");
    assert.ok(typeof aggregated.totalShares === "number");
    assert.ok(typeof aggregated.totalComments === "number");
    assert.ok(typeof aggregated.engagementRate === "number");
    assert.strictEqual(aggregated.totalViews, 0);
    assert.strictEqual(aggregated.totalLikes, 0);
    assert.strictEqual(aggregated.engagementRate, 0);
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

    assert.ok(result.success);
    assert.ok(result.data);
    assert.ok(Array.isArray(result.data.data.trends));
    assert.strictEqual(result.data.data.trends.length, 0);
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("required"));
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Invalid post ID"));
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

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});
