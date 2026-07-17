/**
 * @file GetPostUseCase.ownership.test.ts
 * @description Ownership-gate unit tests for GetPostUseCase (CWE-639). A read is
 *              scoped by the server-derived caller account; a foreign-account post
 *              resolves to NOT_FOUND (anti-enumeration), the owner reads its own
 *              post, and the query repository is invoked with the scoped AccountId.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { GetPostUseCase } from "@core/posts/GetPostUseCase.js";
import {
  AccountId,
  PostId,
  EntityNotFoundError,
  type PostQueryRepository,
  type PostReadModel,
} from "@core/domain/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const OWNER_ACCOUNT = AccountId.generate().value;
const OTHER_ACCOUNT = AccountId.generate().value;
const OWNED_POST = PostId.generate().value;

function makeReadModel(id: string): PostReadModel {
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

/**
 * Account-aware mock query repository. `getById` returns the post ONLY when the
 * scoped AccountId matches the owner — this is exactly what the Prisma
 * `where: { project: { accountId } }` filter does at the adapter level. Any other
 * (or absent) account yields EntityNotFoundError, so a foreign caller cannot
 * distinguish a foreign id from a nonexistent one.
 */
function createMockQueryRepository(): PostQueryRepository {
  return {
    getById: vi.fn(async (id: PostId, accountId: AccountId) => {
      if (accountId && accountId.value === OWNER_ACCOUNT && id.value === OWNED_POST) {
        return ok(makeReadModel(id.value));
      }
      return err(new EntityNotFoundError("Post", id.value));
    }),
    getByIdWithThread: vi.fn(async (id: PostId) => err(new EntityNotFoundError("Post", id.value))),
    listByProject: vi.fn(async () => emptyPage()),
    listGlobal: vi.fn(async () => emptyPage()),
    search: vi.fn(async () => emptyPage()),
    getUpcoming: vi.fn(async () => []),
    getRecentlyPublished: vi.fn(async () => []),
  } as unknown as PostQueryRepository;
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

describe("GetPostUseCase — ownership gate (CWE-639)", () => {
  let repo: PostQueryRepository;
  let useCase: GetPostUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockQueryRepository();
    useCase = new GetPostUseCase(repo);
  });

  it("returns the post and scopes the query by the caller account when the caller owns it", async () => {
    const result = await useCase.execute({
      postId: OWNED_POST,
      callerAccountId: OWNER_ACCOUNT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(OWNED_POST);

    const call = (repo.getById as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(PostId);
    expect(call?.[1]).toBeInstanceOf(AccountId);
    expect((call?.[1] as AccountId).value).toBe(OWNER_ACCOUNT);
  });

  it("returns NOT_FOUND when the caller belongs to another account (foreign post)", async () => {
    const result = await useCase.execute({
      postId: OWNED_POST,
      callerAccountId: OTHER_ACCOUNT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
  });

  it("rejects an invalid caller account id with VALIDATION_FAILED", async () => {
    const result = await useCase.execute({
      postId: OWNED_POST,
      callerAccountId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
