/**
 * @file PostQueryHandlers.errors.test.ts
 * @description Tests for Query Handlers - Error Handling
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import {
  GetPostQueryHandler,
  ListPostsQueryHandler,
  SearchPostsQueryHandler,
  GetPostAnalyticsQueryHandler,
} from "../../src/cqrs/handlers/PostQueryHandlers.js";
import type { Query } from "@shared/types/cqrs.js";
import {
  createMockPostQueryRepository,
  POST_QUERIES,
  VALID_POST_ID,
  VALID_PROJECT_ID,
  type MockPostQueryRepository,
} from "./PostQueryHandlers.test-helpers.js";

describe("Query Handlers - Error Handling", () => {
  let getHandler: GetPostQueryHandler;
  let listHandler: ListPostsQueryHandler;
  let searchHandler: SearchPostsQueryHandler;
  let analyticsHandler: GetPostAnalyticsQueryHandler;
  let mockRepo: MockPostQueryRepository;

  beforeEach(() => {
    mockRepo = createMockPostQueryRepository();

    getHandler = new GetPostQueryHandler({ postQueryRepository: mockRepo });
    listHandler = new ListPostsQueryHandler({ postQueryRepository: mockRepo });
    searchHandler = new SearchPostsQueryHandler({ postQueryRepository: mockRepo });
    analyticsHandler = new GetPostAnalyticsQueryHandler({ postQueryRepository: mockRepo });
  });

  it("should handle repository errors gracefully - GetPost", async () => {
    mockRepo.getById = async () => {
      throw new Error("Database error");
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

    const result = await getHandler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should handle repository errors gracefully - ListPosts", async () => {
    mockRepo.listByProject = async () => {
      throw new Error("Database error");
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

    const result = await listHandler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should handle repository errors gracefully - SearchPosts", async () => {
    mockRepo.search = async () => {
      throw new Error("Database error");
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

    const result = await searchHandler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should handle repository errors gracefully - GetAnalytics", async () => {
    mockRepo.getById = async () => {
      throw new Error("Database error");
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

    const result = await analyticsHandler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should return error for missing postId in analytics query", async () => {
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

    const result = await analyticsHandler.handle(query);

    expect(result.success).toBe(false);
    expect(result.error?.includes("required")).toBeTruthy();
  });

  it("should handle validation errors - invalid query schema", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.GET_POST,
      data: {
        // Missing required postId
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await getHandler.handle(query);

    expect(result.success).toBe(false);
  });

  it("should handle validation errors - invalid list query", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.LIST_POSTS,
      data: {
        // Missing required projectId
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

    const result = await listHandler.handle(query);

    expect(result.success).toBe(false);
  });

  it("should handle validation errors - invalid search query", async () => {
    const query: Query = {
      id: "qry-1",
      type: POST_QUERIES.SEARCH_POSTS,
      data: {
        // Missing required projectId and searchTerm
        limit: 10,
        offset: 0,
      },
      metadata: {
        correlationId: "corr-1",
        source: "test",
      },
      timestamp: new Date(),
    };

    const result = await searchHandler.handle(query);

    expect(result.success).toBe(false);
  });
});
