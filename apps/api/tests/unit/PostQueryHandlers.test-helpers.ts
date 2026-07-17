/**
 * @file PostQueryHandlers.test-helpers.ts
 * @description Test helpers for post query handlers test helpers
 * @layer infrastructure
 */
import type { Query } from "@shared/types/cqrs.js";
import { POST_QUERIES } from "@shared/types/cqrs.js";
import type {
  PostQueryRepository,
  PostReadModel,
  PostReadModelWithThread,
  PaginatedResult,
  PaginationParams,
  SortParams,
  PostSortField,
  GlobalPostFilter,
} from "@core/domain/index.js";
import {
  type PostId,
  type ProjectId,
  type AccountId,
  EntityNotFoundError,
} from "@core/domain/index.js";
import { type Result, ok, err } from "@shared/types";

// Valid UUID v4s for testing (PostId/ProjectId validate UUID v4 format)
export const VALID_POST_ID = "b5adccbb-d962-49da-86d7-9ab24f45637c";
export const VALID_PROJECT_ID = "65207bdb-3c89-44d4-a706-c74c4c2f0bb2";
export const NON_EXISTENT_POST_ID = "867de218-2c60-4def-a027-7fba9f8ab8bd";

/**
 * Sample domain PostReadModel fixtures
 */
function makeDomainPost(overrides?: Partial<PostReadModel>): PostReadModel {
  return {
    id: VALID_POST_ID,
    projectId: VALID_PROJECT_ID,
    title: "Test Post",
    body: "Test post body content",
    status: "PUBLISHED",
    locale: "en",
    tags: ["test", "cqrs"],
    mediaCount: 2,
    publishedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makeDomainPostList(): PostReadModel[] {
  return [
    makeDomainPost({
      id: "78a4802d-1ce4-4da9-a20b-57bb5bba154c",
      title: "Post 1",
      body: "Body 1",
      status: "PUBLISHED",
      tags: ["tag1"],
      mediaCount: 1,
      publishedAt: new Date("2024-01-01"),
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    }),
    makeDomainPost({
      id: "72fe2092-dd0f-4a64-880c-371d4b031384",
      title: "Post 2",
      body: "Body 2",
      status: "DRAFT",
      tags: ["tag2"],
      mediaCount: 0,
      scheduledAt: new Date("2024-02-01"),
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
    }),
  ];
}

/**
 * Mock PostQueryRepository implementing the domain interface.
 * Methods can be overridden per-test for error scenarios.
 */
export class MockPostQueryRepository implements PostQueryRepository {
  async getById(
    id: PostId,
    _accountId: AccountId
  ): Promise<Result<PostReadModel, EntityNotFoundError>> {
    const idStr = id.toString();
    if (idStr === NON_EXISTENT_POST_ID) {
      return err(new EntityNotFoundError("Post", idStr));
    }
    return ok(makeDomainPost({ id: idStr }));
  }

  async listByProject(
    _projectId: ProjectId,
    _accountId: AccountId,
    _pagination?: PaginationParams,
    _sort?: SortParams<PostSortField>
  ): Promise<PaginatedResult<PostReadModel>> {
    const items = makeDomainPostList();
    return {
      items,
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async search(
    _projectId: ProjectId,
    _searchText: string,
    _pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>> {
    const items = makeDomainPostList();
    return {
      items,
      total: items.length,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async getUpcoming(_projectId: ProjectId, _limit?: number): Promise<PostReadModel[]> {
    return [];
  }

  async getRecentlyPublished(_projectId: ProjectId, _limit?: number): Promise<PostReadModel[]> {
    return [];
  }

  async getByIdWithThread(
    id: PostId,
    accountId: AccountId
  ): Promise<Result<PostReadModelWithThread, EntityNotFoundError>> {
    const result = await this.getById(id, accountId);
    if (!result.ok) return result;
    return ok({ ...result.value });
  }

  async listGlobal(
    _accountId: AccountId,
    _filter?: GlobalPostFilter,
    _pagination?: PaginationParams
  ): Promise<PaginatedResult<PostReadModel>> {
    const items = makeDomainPostList();
    return {
      items,
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    };
  }
}

export function createMockPostQueryRepository(): MockPostQueryRepository {
  return new MockPostQueryRepository();
}

export function makeQuery(type: string, data: Record<string, unknown>): Query {
  return {
    id: "qry-1",
    type,
    data,
    metadata: {
      correlationId: "corr-1",
      source: "test",
    },
    timestamp: new Date(),
  };
}

export { POST_QUERIES };
