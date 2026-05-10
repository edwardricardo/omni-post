/**
 * Tier 3 — Core publishing smoke tests
 *
 * Bulk post operations + post lifecycle endpoints. The publishing saga
 * itself is already covered by sagaCustomerFlow.test.ts (13 tests); this
 * tier focuses on the surrounding CRUD surface that customers exercise:
 * bulk archive / duplicate / hard-delete + single-post update + delete.
 *
 * Recurring posts and approvals workflows require deeper fixtures
 * (RecurringPost + ApprovalRequest entities) and land in follow-up tiers.
 *
 * @file posts.smoke.test.ts
 * @description Tier 3 core publishing smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import {
  apiPost,
  apiPatch,
  apiDelete,
  expectError,
  createTestAccountWithProject,
  createTestPost,
  cleanupTestAccount,
  API_BASE_URL,
  type TestProjectFixture,
} from "./helpers/index.js";

describe("Tier 3 — Core publishing smoke", () => {
  let prisma: PrismaClient;
  let owner: TestProjectFixture;
  let other: TestProjectFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    owner = await createTestAccountWithProject(prisma, { tagPrefix: "posts-owner" });
    other = await createTestAccountWithProject(prisma, { tagPrefix: "posts-other" });
  });

  after(async () => {
    if (!prisma) return;
    try {
      await cleanupTestAccount(prisma, owner.accountId);
      await cleanupTestAccount(prisma, other.accountId);
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // Bulk archive
  // -----------------------------------------------------------------------

  it("bulk-archives posts the caller owns (happy)", async () => {
    const p1 = await createTestPost(prisma, owner.projectId);
    const p2 = await createTestPost(prisma, owner.projectId);

    const result = await apiPatch(
      "/posts/batch/archive",
      { postIds: [p1.id, p2.id] },
      owner.authHeader
    );
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);

    // Verify posts are archived in DB
    const archived = await prisma.post.findMany({
      where: { id: { in: [p1.id, p2.id] } },
      select: { id: true, archivedAt: true },
    });
    assert.strictEqual(archived.length, 2, "both posts persist");
    for (const post of archived) {
      assert.ok(post.archivedAt !== null, `post ${post.id} archivedAt set`);
    }
  });

  it("rejects bulk archive of posts owned by another tenant (no leakage)", async () => {
    const otherPost = await createTestPost(prisma, other.projectId);

    const result = await apiPatch(
      "/posts/batch/archive",
      { postIds: [otherPost.id] },
      owner.authHeader
    );
    // The use case must NOT archive cross-tenant posts. Either it returns
    // a result that reports zero archived (200 with count: 0) or rejects
    // outright (404). Both are valid; what's NOT valid is the post ending
    // up archivedAt != null.
    const post = await prisma.post.findUnique({
      where: { id: otherPost.id },
      select: { archivedAt: true },
    });
    assert.strictEqual(
      post?.archivedAt,
      null,
      `cross-tenant post must NOT be archived (status was ${result.status})`
    );
  });

  it("rejects bulk archive with malformed body (400)", async () => {
    const result = await apiPatch(
      "/posts/batch/archive",
      { postIds: ["not-a-uuid"] },
      owner.authHeader
    );
    expectError(result, 400);
  });

  it("rejects bulk archive without auth (401)", async () => {
    const result = await apiPatch("/posts/batch/archive", { postIds: [] });
    expectError(result, 401);
  });

  // -----------------------------------------------------------------------
  // Bulk duplicate
  // -----------------------------------------------------------------------

  it("bulk-duplicates posts as new DRAFTs (happy)", async () => {
    const original = await createTestPost(prisma, owner.projectId, {
      body: "original content for duplication",
    });

    const result = await apiPost<{ data: { duplicated: Array<{ id: string }> } }>(
      "/posts/batch/duplicate",
      { postIds: [original.id] },
      owner.authHeader
    );
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);

    // Verify a new Post row exists (id != original) with status DRAFT
    const allPosts = await prisma.post.findMany({
      where: { projectId: owner.projectId },
      select: { id: true, status: true },
    });
    const drafts = allPosts.filter((p) => p.status === "DRAFT" && p.id !== original.id);
    assert.ok(drafts.length >= 1, "at least one duplicated DRAFT exists");
  });

  it("rejects bulk duplicate with empty array (400)", async () => {
    const result = await apiPost("/posts/batch/duplicate", { postIds: [] }, owner.authHeader);
    expectError(result, 400);
  });

  // -----------------------------------------------------------------------
  // Single-post update + delete (post-saga lifecycle)
  // -----------------------------------------------------------------------

  it("updates a draft post body (200)", async () => {
    const post = await createTestPost(prisma, owner.projectId);

    const result = await apiPatch(
      `/posts/${post.id}`,
      { body: "revised content body" },
      owner.authHeader
    );
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);

    const content = await prisma.postContent.findFirst({
      where: { postId: post.id },
      select: { body: true },
    });
    assert.strictEqual(content?.body, "revised content body");
  });

  it("rejects update on cross-tenant post (404 / 403)", async () => {
    const otherPost = await createTestPost(prisma, other.projectId);
    const result = await apiPatch(
      `/posts/${otherPost.id}`,
      { body: "should not apply" },
      owner.authHeader
    );
    assert.ok([403, 404].includes(result.status), `expected 403 or 404, got ${result.status}`);

    // Verify no mutation
    const content = await prisma.postContent.findFirst({
      where: { postId: otherPost.id },
      select: { body: true },
    });
    assert.notStrictEqual(content?.body, "should not apply");
  });

  it("soft-deletes a post (DELETE /posts/:id)", async () => {
    const post = await createTestPost(prisma, owner.projectId);

    const result = await apiDelete(`/posts/${post.id}`, owner.authHeader);
    assert.strictEqual(result.status, 200);

    const dbPost = await prisma.post.findUnique({
      where: { id: post.id },
      select: { deletedAt: true },
    });
    assert.ok(dbPost?.deletedAt !== null, "post.deletedAt set");
  });

  it("rejects update without auth (401)", async () => {
    const post = await createTestPost(prisma, owner.projectId);
    const result = await apiPatch(`/posts/${post.id}`, { body: "no auth" });
    expectError(result, 401);
  });
});
