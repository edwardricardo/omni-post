/**
 * @file GetPostWithThreadQuery.ownership.test.ts
 * @description Ownership-gate unit tests for GetPostWithThreadQuery (CWE-639). The
 *              thread-expanded read is scoped by the server-derived caller account;
 *              a foreign-account post resolves to NOT_FOUND, the owner reads its own
 *              post + thread, and getByIdWithThread is invoked with the scoped AccountId.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { GetPostWithThreadQuery } from "@core/posts/GetPostWithThreadQuery.js";
import {
  AccountId,
  PostId,
  EntityNotFoundError,
  type PostQueryRepository,
  type PostReadModelWithThread,
} from "@core/domain/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const OWNER_ACCOUNT = AccountId.generate().value;
const OTHER_ACCOUNT = AccountId.generate().value;
const OWNED_POST = PostId.generate().value;

function makeThreadReadModel(id: string): PostReadModelWithThread {
  return {
    id,
    projectId: "a0000000-0000-4000-8000-000000000001",
    body: "owned post body",
    status: "DRAFT",
    locale: "en",
    tags: [],
    mediaCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function emptyPage() {
  return {
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  };
}

function createMockQueryRepository(): PostQueryRepository {
  return {
    getById: vi.fn(async (id: PostId) => err(new EntityNotFoundError("Post", id.value))),
    getByIdWithThread: vi.fn(async (id: PostId, accountId: AccountId) => {
      if (accountId && accountId.value === OWNER_ACCOUNT && id.value === OWNED_POST) {
        return ok(makeThreadReadModel(id.value));
      }
      return err(new EntityNotFoundError("Post", id.value));
    }),
    listByProject: vi.fn(async () => emptyPage()),
    listGlobal: vi.fn(async () => emptyPage()),
    search: vi.fn(async () => emptyPage()),
    getUpcoming: vi.fn(async () => []),
    getRecentlyPublished: vi.fn(async () => []),
  } as unknown as PostQueryRepository;
}

describe("GetPostWithThreadQuery — ownership gate (CWE-639)", () => {
  let repo: PostQueryRepository;
  let query: GetPostWithThreadQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockQueryRepository();
    query = new GetPostWithThreadQuery(repo);
  });

  it("returns the post and scopes the query by the caller account when the caller owns it", async () => {
    const result = await query.execute({
      postId: OWNED_POST,
      callerAccountId: OWNER_ACCOUNT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(OWNED_POST);

    const call = (repo.getByIdWithThread as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(call?.[0]).toBeInstanceOf(PostId);
    expect(call?.[1]).toBeInstanceOf(AccountId);
    expect((call?.[1] as AccountId).value).toBe(OWNER_ACCOUNT);
  });

  it("returns NOT_FOUND when the caller belongs to another account (foreign post)", async () => {
    const result = await query.execute({
      postId: OWNED_POST,
      callerAccountId: OTHER_ACCOUNT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
  });
});
