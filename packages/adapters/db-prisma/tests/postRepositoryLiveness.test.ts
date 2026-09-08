/**
 * @file postRepositoryLiveness.test.ts
 * @description Liveness-chain classification tests for PostRepository.getPostById:
 *              a soft-deleted post, project, or account must surface as the
 *              distinct "SOFT_DELETED" error (the publish worker's terminal
 *              no-op signal), never as a publishable ok(post) and never
 *              collapsed into "NOT_FOUND" (which BullMQ retries).
 *              Tier 0: no DB — mocked PrismaClient with rows shaped exactly as
 *              Postgres returns them for the repository's own query.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { createPostRepository } from "../src/index.js";

const NOW = new Date("2026-09-01T12:00:00Z");
const DELETED_AT = new Date("2026-09-02T00:00:00Z");

/**
 * A post row as Prisma returns it for getPostById's own query: scalars plus the included
 * contents/media. The parent chain is NOT part of this row any more — it is read separately,
 * under the system scope, because `Project` carries a tenant policy and `Post` does not, so
 * as a nested include the parent came back null for the application role.
 */
function postRow(overrides?: Record<string, unknown>) {
  return {
    id: "post-1",
    projectId: "proj-1",
    status: "SCHEDULED",
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
    deletedAt: null as Date | null,
    createdAt: NOW,
    updatedAt: NOW,
    contents: [
      {
        id: "pc-1",
        postId: "post-1",
        locale: "en",
        title: null,
        summary: null,
        body: "post body",
        tags: [],
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    media: [],
    ...overrides,
  };
}

/** The parent chain as the separate, system-scoped read returns it. */
function parentRow(overrides?: { deletedAt?: Date | null; accountDeletedAt?: Date | null }) {
  return {
    deletedAt: overrides?.deletedAt ?? null,
    account: { deletedAt: overrides?.accountDeletedAt ?? null },
  };
}

interface MockPrisma {
  post: { findUnique: ReturnType<typeof vi.fn> };
  project: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  boundScopes: string[];
}

/**
 * Models BOTH reads and the transaction the second one opens. `$executeRaw` records the scope
 * the seam binds, so the suite can assert the system scope is DECLARED rather than assumed.
 */
function makeMockPrisma(
  row: ReturnType<typeof postRow> | null,
  parent: ReturnType<typeof parentRow> | null = parentRow()
) {
  const boundScopes: string[] = [];
  const tx = {
    project: { findUnique: vi.fn(async () => parent) },
    $executeRaw: vi.fn(async (_strings: unknown, scope: string) => {
      boundScopes.push(scope);
      return 1;
    }),
  };
  const mock: MockPrisma = {
    post: { findUnique: vi.fn(async () => row) },
    project: tx.project,
    $executeRaw: tx.$executeRaw,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    boundScopes,
  };
  return mock as unknown as PrismaClient & MockPrisma;
}

const mockTransactionBreaker = {
  fire: (fn: () => Promise<unknown>) => fn(),
};

describe("PostRepository.getPostById — deletion liveness chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok(post) when post, project, and account are all live", async () => {
    const prisma = makeMockPrisma(postRow());
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    assert.strictEqual(result.value.id, "post-1");
  });

  it("returns SOFT_DELETED when the post itself is soft-deleted", async () => {
    const prisma = makeMockPrisma(postRow({ deletedAt: DELETED_AT }));
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(!result.ok, "a soft-deleted post must not be publishable");
    assert.strictEqual(result.error, "SOFT_DELETED");
  });

  it("returns SOFT_DELETED when the parent PROJECT is soft-deleted (post row still live)", async () => {
    const prisma = makeMockPrisma(postRow(), parentRow({ deletedAt: DELETED_AT }));
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(!result.ok, "a deleted project's post must not be publishable");
    assert.strictEqual(result.error, "SOFT_DELETED");
  });

  it("returns SOFT_DELETED when the parent ACCOUNT is soft-deleted (post + project live)", async () => {
    const prisma = makeMockPrisma(postRow(), parentRow({ accountDeletedAt: DELETED_AT }));
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(!result.ok, "a deleted account's post must not be publishable");
    assert.strictEqual(result.error, "SOFT_DELETED");
  });

  it("keeps NOT_FOUND for a missing row — SOFT_DELETED is never conflated with absence", async () => {
    const prisma = makeMockPrisma(null);
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("missing");

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NOT_FOUND");
  });

  it("treats a parent it cannot resolve as a dead chain rather than a publishable post", async () => {
    const prisma = makeMockPrisma(postRow(), null);
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(!result.ok, "a post whose parent cannot be resolved must not be publishable");
    assert.strictEqual(result.error, "SOFT_DELETED");
  });

  it("requests the parent chain's liveness columns, and only those", async () => {
    // The mock answers regardless of the query, so this assertion is what ties the fixture to
    // the real projection: if the select is ever widened or dropped, this test reds even though
    // the classification above would keep seeing fixture data a real row no longer carries.
    const prisma = makeMockPrisma(postRow());
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    await repo.getPostById("post-1");

    expect(prisma.project.findUnique).toHaveBeenCalledTimes(1);
    const call = prisma.project.findUnique.mock.calls[0]?.[0] as {
      where?: { id?: string };
      select?: Record<string, unknown>;
    };
    assert.deepStrictEqual(call?.where, { id: "proj-1" });
    assert.deepStrictEqual(call?.select, {
      deletedAt: true,
      account: { select: { deletedAt: true } },
    });
  });

  it("binds the parent read under the DECLARED system scope, inside a transaction", async () => {
    // The scope is the whole reason the parent read is separate. Asserting the transaction
    // alone would pass for an unbound one, which is the state that returned null.
    const prisma = makeMockPrisma(postRow());
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    await repo.getPostById("post-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    assert.deepStrictEqual(prisma.boundScopes, ["__system__"]);
  });
});
