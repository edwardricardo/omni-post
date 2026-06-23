/**
 * @file postUseCasesTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-POSTS) regression tests for the post
 *              read/delete use cases. Asserts that a caller authenticated as
 *              tenant B can neither delete, get, nor list tenant A's posts once
 *              `callerAccountId` is threaded from the route. Posts are
 *              transitively tenant-scoped (FK -> Project.accountId) so the Prisma
 *              `$extends` guard cannot auto-inject — the owner gate must live at
 *              the use-case boundary (single-post) and as a joined filter in the
 *              query repository (lists).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { PostAggregate, ProjectId, PostId, AccountId } from "@core/domain/index.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { DeletePostUseCase } from "@core/posts/DeletePostUseCase.js";
import { GetPostUseCase } from "@core/posts/GetPostUseCase.js";
import { GetPostWithThreadQuery } from "@core/posts/GetPostWithThreadQuery.js";
import { ListPostsUseCase } from "@core/posts/ListPostsUseCase.js";
import { ListPostsGlobalQuery } from "@core/posts/ListPostsGlobalQuery.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const TENANT_A = AccountId.generate().value;
const TENANT_B = AccountId.generate().value;
const PROJECT_A = ProjectId.generate().value;

// --- Mock factories with the tenant-ownership hooks ---

/**
 * Command-side repo mock. `findOwnerAccountId` resolves the owner via the
 * post -> project -> accountId chain (modelled here as a flat ownership map).
 */
function createMockPostRepository() {
  const store = new Map<string, PostAggregate>();
  const owner = new Map<string, string>(); // postId -> accountId
  return {
    store,
    owner,
    findById: vi.fn(async (id: PostId) => {
      const post = store.get(id.value);
      if (!post) return err(new EntityNotFoundError("Post", id.value));
      return ok(post);
    }),
    delete: vi.fn(async (id: PostId) => {
      if (!store.has(id.value)) return err(new EntityNotFoundError("Post", id.value));
      store.delete(id.value);
      return ok(undefined);
    }),
    findOwnerAccountId: vi.fn(async (id: PostId) => {
      const acc = owner.get(id.value);
      return acc ? AccountId.fromStringUnsafe(acc) : null;
    }),
    save: vi.fn(),
    findByProjectId: vi.fn(),
    findByStatus: vi.fn(),
    findReadyForPublishing: vi.fn(),
    findWithFilters: vi.fn(),
    countByProjectId: vi.fn(),
    countByStatus: vi.fn(),
    getProjectStats: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkArchive: vi.fn(),
    bulkHardDelete: vi.fn(),
    hardDelete: vi.fn(),
    filterIdsByAccount: vi.fn(),
  };
}

function createMockBusinessMetrics() {
  return {
    incrementPostCreated: vi.fn(),
    incrementPostPublished: vi.fn(),
    incrementPostDeleted: vi.fn(),
  };
}

interface OwnedRow {
  id: string;
  projectId: string;
  accountId: string; // owning tenant (modelled for the joined-filter mock)
  body: string;
}

/**
 * Query-side repo mock. The read methods accept an optional `callerAccountId`
 * (the joined-filter gate). When present, rows whose owning accountId does not
 * match are filtered out — mirroring `where: { project: { accountId } }`.
 */
function createMockQueryRepository() {
  const rows = new Map<string, OwnedRow>();
  const toReadModel = (r: OwnedRow) => ({
    id: r.id,
    projectId: r.projectId,
    body: r.body,
    status: "DRAFT",
    locale: "en",
    tags: [],
    mediaCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return {
    rows,
    getById: vi.fn(async (id: PostId, callerAccountId?: AccountId) => {
      const row = rows.get(id.value);
      if (!row) return err(new EntityNotFoundError("Post", id.value));
      if (callerAccountId && row.accountId !== callerAccountId.value) {
        return err(new EntityNotFoundError("Post", id.value));
      }
      return ok(toReadModel(row));
    }),
    getByIdWithThread: vi.fn(async (id: PostId, callerAccountId?: AccountId) => {
      const row = rows.get(id.value);
      if (!row) return err(new EntityNotFoundError("Post", id.value));
      if (callerAccountId && row.accountId !== callerAccountId.value) {
        return err(new EntityNotFoundError("Post", id.value));
      }
      return ok(toReadModel(row));
    }),
    listByProject: vi.fn(
      async (
        projectId: ProjectId,
        pagination?: { page?: number; limit?: number },
        _sort?: unknown,
        _filter?: unknown,
        callerAccountId?: AccountId
      ) => {
        const items = Array.from(rows.values())
          .filter((r) => r.projectId === projectId.value)
          .filter((r) => !callerAccountId || r.accountId === callerAccountId.value)
          .map(toReadModel);
        const page = pagination?.page ?? 1;
        const limit = Math.min(pagination?.limit ?? 20, 100);
        const total = items.length;
        const totalPages = Math.ceil(total / limit) || 0;
        return {
          items,
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        };
      }
    ),
    listGlobal: vi.fn(
      async (
        _filter?: unknown,
        pagination?: { page?: number; limit?: number },
        callerAccountId?: AccountId
      ) => {
        const items = Array.from(rows.values())
          .filter((r) => !callerAccountId || r.accountId === callerAccountId.value)
          .map(toReadModel);
        const page = pagination?.page ?? 1;
        const limit = Math.min(pagination?.limit ?? 20, 100);
        const total = items.length;
        const totalPages = Math.ceil(total / limit) || 0;
        return {
          items,
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        };
      }
    ),
    search: vi.fn(),
    getUpcoming: vi.fn(),
    getRecentlyPublished: vi.fn(),
  };
}

describe("Post use cases — tenant isolation (IDOR-POSTS, CWE-639)", () => {
  describe("DeletePostUseCase", () => {
    let repo: ReturnType<typeof createMockPostRepository>;
    let useCase: DeletePostUseCase;
    let postA: PostAggregate;

    beforeEach(() => {
      repo = createMockPostRepository();
      useCase = new DeletePostUseCase(repo as never, createMockBusinessMetrics() as never);
      const created = PostAggregate.create({
        projectId: ProjectId.fromStringUnsafe(PROJECT_A),
        body: "Tenant A draft",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      postA = created.value;
      repo.store.set(postA.id.value, postA);
      repo.owner.set(postA.id.value, TENANT_A);
    });

    it("returns not-found and performs no delete when tenant B deletes tenant A's post", async () => {
      const result = await useCase.execute({
        postId: postA.id.value,
        callerAccountId: TENANT_B,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.store.has(postA.id.value)).toBe(true);
    });

    it("deletes successfully when the owning tenant A deletes its own post", async () => {
      const result = await useCase.execute({
        postId: postA.id.value,
        callerAccountId: TENANT_A,
      });
      expect(result.ok).toBe(true);
      expect(repo.delete).toHaveBeenCalledOnce();
      expect(repo.store.has(postA.id.value)).toBe(false);
    });
  });

  describe("GetPostUseCase", () => {
    let queryRepo: ReturnType<typeof createMockQueryRepository>;
    let useCase: GetPostUseCase;
    const postId = PostId.generate().value;

    beforeEach(() => {
      queryRepo = createMockQueryRepository();
      useCase = new GetPostUseCase(queryRepo as never);
      queryRepo.rows.set(postId, {
        id: postId,
        projectId: PROJECT_A,
        accountId: TENANT_A,
        body: "Tenant A body",
      });
    });

    it("returns not-found when tenant B gets tenant A's post by id", async () => {
      const result = await useCase.execute({ postId, callerAccountId: TENANT_B });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });

    it("returns the post when the owning tenant A gets its own post", async () => {
      const result = await useCase.execute({ postId, callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(postId);
      expect(result.value.body).toBe("Tenant A body");
    });
  });

  describe("GetPostWithThreadQuery", () => {
    let queryRepo: ReturnType<typeof createMockQueryRepository>;
    let query: GetPostWithThreadQuery;
    const postId = PostId.generate().value;

    beforeEach(() => {
      queryRepo = createMockQueryRepository();
      query = new GetPostWithThreadQuery(queryRepo as never);
      queryRepo.rows.set(postId, {
        id: postId,
        projectId: PROJECT_A,
        accountId: TENANT_A,
        body: "Tenant A threaded body",
      });
    });

    it("returns not-found when tenant B gets tenant A's threaded post", async () => {
      const result = await query.execute({ postId, callerAccountId: TENANT_B });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });

    it("returns the post when the owning tenant A gets its own threaded post", async () => {
      const result = await query.execute({ postId, callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(postId);
    });
  });

  describe("ListPostsUseCase", () => {
    let queryRepo: ReturnType<typeof createMockQueryRepository>;
    let useCase: ListPostsUseCase;

    beforeEach(() => {
      queryRepo = createMockQueryRepository();
      useCase = new ListPostsUseCase(queryRepo as never);
      // 2 posts in PROJECT_A owned by tenant A
      for (let i = 0; i < 2; i++) {
        const id = PostId.generate().value;
        queryRepo.rows.set(id, {
          id,
          projectId: PROJECT_A,
          accountId: TENANT_A,
          body: `A ${i}`,
        });
      }
    });

    it("returns zero items when tenant B lists tenant A's project", async () => {
      const result = await useCase.execute({
        projectId: PROJECT_A,
        callerAccountId: TENANT_B,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(0);
      expect(result.value.total).toBe(0);
    });

    it("returns the owning tenant A's posts when tenant A lists its project", async () => {
      const result = await useCase.execute({
        projectId: PROJECT_A,
        callerAccountId: TENANT_A,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(2);
      expect(result.value.total).toBe(2);
    });
  });

  describe("ListPostsGlobalQuery", () => {
    let queryRepo: ReturnType<typeof createMockQueryRepository>;
    let query: ListPostsGlobalQuery;

    beforeEach(() => {
      queryRepo = createMockQueryRepository();
      query = new ListPostsGlobalQuery(queryRepo as never);
      // tenant A: 2 posts, tenant B: 1 post
      for (let i = 0; i < 2; i++) {
        const id = PostId.generate().value;
        queryRepo.rows.set(id, { id, projectId: PROJECT_A, accountId: TENANT_A, body: `A ${i}` });
      }
      const bId = PostId.generate().value;
      queryRepo.rows.set(bId, {
        id: bId,
        projectId: ProjectId.generate().value,
        accountId: TENANT_B,
        body: "B 0",
      });
    });

    it("returns only the caller's tenant rows, never all tenants' posts", async () => {
      const result = await query.execute({ callerAccountId: TENANT_A });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(2);
      expect(result.value.items.every((p) => p.body.startsWith("A"))).toBe(true);
    });

    it("returns the other tenant's own rows for that tenant only", async () => {
      const result = await query.execute({ callerAccountId: TENANT_B });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(1);
      expect(result.value.items[0]?.body).toBe("B 0");
    });
  });
});
