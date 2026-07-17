/**
 * @file ListPostsUseCase.ownership.test.ts
 * @description Ownership-gate unit tests for ListPostsUseCase (CWE-639). The
 *              by-project list is scoped by the server-derived caller account;
 *              a project owned by another account yields an empty page (never that
 *              account's posts), and listByProject is invoked with the scoped AccountId.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ListPostsUseCase } from "@core/posts/ListPostsUseCase.js";
import {
  AccountId,
  ProjectId,
  type PostQueryRepository,
  type PostReadModel,
} from "@core/domain/index.js";

const OWNER_ACCOUNT = AccountId.generate().value;
const OTHER_ACCOUNT = AccountId.generate().value;
const PROJECT_ID = ProjectId.generate().value;

function makeReadModel(): PostReadModel {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    body: "owned post body",
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
 * Account-aware mock. `listByProject` returns the project's posts ONLY when the
 * scoped AccountId matches the owner — mirroring the Prisma
 * `where: { projectId, project: { accountId } }` filter. A foreign caller gets an
 * empty page, never the owner's rows.
 */
function createMockQueryRepository(): PostQueryRepository {
  return {
    getById: vi.fn(),
    getByIdWithThread: vi.fn(),
    listByProject: vi.fn(async (_projectId: ProjectId, accountId: AccountId) => {
      if (accountId && accountId.value === OWNER_ACCOUNT) {
        return page([makeReadModel()]);
      }
      return page([]);
    }),
    listGlobal: vi.fn(async () => page([])),
    search: vi.fn(async () => page([])),
    getUpcoming: vi.fn(async () => []),
    getRecentlyPublished: vi.fn(async () => []),
  } as unknown as PostQueryRepository;
}

describe("ListPostsUseCase — ownership gate (CWE-639)", () => {
  let repo: PostQueryRepository;
  let useCase: ListPostsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockQueryRepository();
    useCase = new ListPostsUseCase(repo);
  });

  it("returns the owner's posts and passes the scoped account as the second argument", async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      callerAccountId: OWNER_ACCOUNT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);

    const call = (repo.listByProject as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(ProjectId);
    expect(call?.[1]).toBeInstanceOf(AccountId);
    expect((call?.[1] as AccountId).value).toBe(OWNER_ACCOUNT);
  });

  it("returns an empty page for a project owned by another account (no foreign posts)", async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      callerAccountId: OTHER_ACCOUNT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
    expect(result.value.total).toBe(0);
  });
});
