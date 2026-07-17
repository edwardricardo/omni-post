/**
 * @file ListPostsGlobalQuery.ownership.test.ts
 * @description Ownership-gate unit tests for ListPostsGlobalQuery (CWE-639). The
 *              unfiltered `GET /posts` list is scoped to the server-derived caller
 *              account (Option A): it returns only the caller's own posts across
 *              projects, never another account's, and listGlobal is invoked with the
 *              scoped AccountId as its first argument.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ListPostsGlobalQuery } from "@core/posts/ListPostsGlobalQuery.js";
import { AccountId, type PostQueryRepository, type PostReadModel } from "@core/domain/index.js";

const ACCOUNT_A = AccountId.generate().value;
const ACCOUNT_B = AccountId.generate().value;

function makeReadModel(): PostReadModel {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    projectId: "a0000000-0000-4000-8000-000000000001",
    body: "account A post",
    status: "DRAFT",
    locale: "en",
    tags: [],
    mediaCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function page(items: PostReadModel[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
    hasNext: false,
    hasPrevious: false,
  };
}

/**
 * Account-aware mock. `listGlobal` returns rows ONLY when scoped to ACCOUNT_A —
 * mirroring the Prisma `where: { project: { accountId } }` filter. A caller in any
 * other account sees an empty page, never account A's rows.
 */
function createMockQueryRepository(): PostQueryRepository {
  return {
    getById: vi.fn(),
    getByIdWithThread: vi.fn(),
    listByProject: vi.fn(async () => page([])),
    listGlobal: vi.fn(async (accountId: AccountId) => {
      if (accountId && accountId.value === ACCOUNT_A) {
        return page([makeReadModel()]);
      }
      return page([]);
    }),
    search: vi.fn(async () => page([])),
    getUpcoming: vi.fn(async () => []),
    getRecentlyPublished: vi.fn(async () => []),
  } as unknown as PostQueryRepository;
}

describe("ListPostsGlobalQuery — ownership gate (CWE-639)", () => {
  let repo: PostQueryRepository;
  let query: ListPostsGlobalQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockQueryRepository();
    query = new ListPostsGlobalQuery(repo);
  });

  it("returns only the caller's posts and passes the scoped account as the first argument", async () => {
    const result = await query.execute({ callerAccountId: ACCOUNT_A });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);

    const call = (repo.listGlobal as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(AccountId);
    expect((call?.[0] as AccountId).value).toBe(ACCOUNT_A);
  });

  it("returns an empty page for a different account (never leaks account A's posts)", async () => {
    const result = await query.execute({ callerAccountId: ACCOUNT_B });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
    expect(result.value.total).toBe(0);
  });
});
