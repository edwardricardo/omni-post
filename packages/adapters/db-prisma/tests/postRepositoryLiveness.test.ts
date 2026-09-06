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
 * A post row as Prisma returns it for getPostById's query: scalars plus the
 * included contents/media and the liveness columns of the parent chain.
 * Mock-fidelity note: this fixture mirrors a REAL joined row — `project` and
 * `project.account` are always present because the FKs are required; only
 * their `deletedAt` values vary.
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
    project: {
      deletedAt: null as Date | null,
      account: { deletedAt: null as Date | null },
    },
    ...overrides,
  };
}

function makeMockPrisma(row: ReturnType<typeof postRow> | null) {
  return {
    post: {
      findUnique: vi.fn(async () => row),
    },
  } as unknown as PrismaClient & { post: { findUnique: ReturnType<typeof vi.fn> } };
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
    const prisma = makeMockPrisma(
      postRow({ project: { deletedAt: DELETED_AT, account: { deletedAt: null } } })
    );
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    const result = await repo.getPostById("post-1");

    assert.ok(!result.ok, "a deleted project's post must not be publishable");
    assert.strictEqual(result.error, "SOFT_DELETED");
  });

  it("returns SOFT_DELETED when the parent ACCOUNT is soft-deleted (post + project live)", async () => {
    const prisma = makeMockPrisma(
      postRow({ project: { deletedAt: null, account: { deletedAt: DELETED_AT } } })
    );
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

  it("requests the parent chain's liveness columns in the query itself", async () => {
    // The mock returns the fixture regardless of the query, so this assertion is
    // what ties the fixture's `project.account` shape to the real query: if the
    // include is ever dropped, this test reds even though the classification
    // above would keep seeing fixture data a real row no longer carries.
    const prisma = makeMockPrisma(postRow());
    const repo = createPostRepository(mockTransactionBreaker, prisma);

    await repo.getPostById("post-1");

    expect(prisma.post.findUnique).toHaveBeenCalledTimes(1);
    const call = prisma.post.findUnique.mock.calls[0]?.[0] as {
      include?: { project?: { select?: Record<string, unknown> } };
    };
    assert.ok(call?.include?.project, "query must include the parent project");
    assert.deepStrictEqual(call.include.project, {
      select: { deletedAt: true, account: { select: { deletedAt: true } } },
    });
  });
});
