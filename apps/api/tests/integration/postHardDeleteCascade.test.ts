/**
 * @file postHardDeleteCascade.test.ts
 * @description Pins the DATABASE blast radius of `DELETE /posts/batch` against the real
 *              schema, by issuing the exact call the route makes:
 *              `post.deleteMany({ where: { id: { in: [...] } } })`
 *              (`PrismaPostRepository.bulkHardDelete`).
 *
 *              WHY A REAL DATABASE. What this route destroys is decided by PostgreSQL
 *              referential actions, not by application code — the repository issues one
 *              statement and the server does the rest. A mocked Prisma client can only
 *              ever echo the statement back; it cannot answer "and what else went with
 *              it". The convention that ships in this slice swaps 25 FK actions, four of
 *              them on Post's own children, so the blast radius is a NEW fact about the
 *              system and belongs in a test rather than in a review comment.
 *
 *              WHAT CHANGED, measured. Before the convention, `PostContent.postId` and
 *              `PostMedia.postId` were ON DELETE RESTRICT and `PrismaPostRepository`
 *              writes exactly one `PostContent` row per post it creates — so this
 *              `deleteMany` raised P2003 for every post the application can produce.
 *              After it, the same call succeeds and cascades. The route is admin-gated
 *              for exactly that reason (see `postRoutes.hardDeletePostsBatch`).
 *
 *              Each assertion below names one referential action. Flip any of them back
 *              in `schema.prisma` and the matching assertion fails: a `deletedAt`-style
 *              silent behaviour change cannot land unobserved.
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestPrismaClient } from "@infra/prisma";

let prisma: ReturnType<typeof createTestPrismaClient>;

/** Ids created by the current fixture, torn down after every test. */
let accountId: string;
let projectId: string;
let channelId: string;
let postId: string;

/**
 * Builds one account -> project -> (channel, post) graph, with a child on every
 * Post relation whose referential action this suite asserts.
 */
async function seedFixture(): Promise<void> {
  const account = await prisma.account.create({
    data: { email: `cascade-${randomUUID()}@omnipost.test`, name: "cascade fixture" },
  });
  accountId = account.id;

  const project = await prisma.project.create({
    data: { accountId, name: `cascade-${randomUUID()}` },
  });
  projectId = project.id;

  const channel = await prisma.channel.create({
    data: {
      accountId,
      projectId,
      provider: "X",
      handle: `@cascade-${randomUUID()}`,
      credentialsCiphertext: "ct",
      credentialsIv: "iv",
      credentialsAuthTag: "tag",
    },
  });
  channelId = channel.id;

  const post = await prisma.post.create({ data: { projectId } });
  postId = post.id;

  // CASCADE children — must be gone after the delete.
  await prisma.postContent.create({
    data: { postId, locale: "en", body: "cascade body", tags: [] },
  });
  await prisma.postMedia.create({
    data: { postId, url: "https://example.test/cascade.png", type: "image" },
  });
  await prisma.repurposeProposal.create({
    data: {
      accountId,
      sourcePostId: postId,
      sourcePlatform: "X",
      engagementRate: "0.010000",
      engagementMultiplier: "1.000000",
    },
  });

  // SET NULL children — must survive with a nulled postId.
  await prisma.analytics.create({ data: { postId, channelId, provider: "X" } });
  await prisma.publishLog.create({
    data: {
      postId,
      channelId,
      provider: "X",
      payload: {},
      dedupeKey: `cascade-${randomUUID()}`,
      status: "OK",
    },
  });
}

async function teardownFixture(): Promise<void> {
  // Deleting the account walks the same convention under test, so tear down from
  // the leaves upward with explicit statements instead — a teardown that leans on
  // the behaviour being asserted cannot report when that behaviour breaks.
  await prisma.analytics.deleteMany({ where: { channelId } });
  await prisma.publishLog.deleteMany({ where: { channelId } });
  await prisma.repurposeProposal.deleteMany({ where: { accountId } });
  await prisma.postMedia.deleteMany({ where: { post: { projectId } } });
  await prisma.postContent.deleteMany({ where: { post: { projectId } } });
  await prisma.recurringPost.deleteMany({ where: { accountId } });
  await prisma.post.deleteMany({ where: { projectId } });
  await prisma.channel.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { accountId } });
  await prisma.account.deleteMany({ where: { id: accountId } });
}

describe("DELETE /posts/batch — database blast radius", () => {
  before(() => {
    // Built here, not at module scope: a client constructed while the module
    // evaluates throws BEFORE any test exists, and node:test reports that as one
    // anonymous failure with no name to read.
    prisma = createTestPrismaClient();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await seedFixture();
  });

  it("destroys the post's contents, media and repurpose proposals (ON DELETE CASCADE)", async () => {
    const result = await prisma.post.deleteMany({ where: { id: { in: [postId] } } });
    assert.equal(result.count, 1, "the post itself must be gone");

    assert.equal(
      await prisma.postContent.count({ where: { postId } }),
      0,
      "PostContent.postId is ON DELETE CASCADE — before the convention this same call raised P2003 here"
    );
    assert.equal(
      await prisma.postMedia.count({ where: { postId } }),
      0,
      "PostMedia.postId is ON DELETE CASCADE"
    );
    assert.equal(
      await prisma.repurposeProposal.count({ where: { sourcePostId: postId } }),
      0,
      "RepurposeProposal.sourcePostId is ON DELETE CASCADE"
    );

    await teardownFixture();
  });

  it("keeps analytics and publish logs, unattributed (ON DELETE SET NULL)", async () => {
    await prisma.post.deleteMany({ where: { id: { in: [postId] } } });

    const analytics = await prisma.analytics.findMany({ where: { channelId } });
    assert.equal(analytics.length, 1, "Analytics.postId is SET NULL — the row must survive");
    assert.equal(
      analytics[0]?.postId,
      null,
      "the surviving analytics row must be detached from the destroyed post"
    );

    const logs = await prisma.publishLog.findMany({ where: { channelId } });
    assert.equal(logs.length, 1, "PublishLog.postId is SET NULL — the row must survive");
    assert.equal(logs[0]?.postId, null, "the surviving publish log must be detached");

    await teardownFixture();
  });

  it("still refuses to delete a post used as a recurring-post template (ON DELETE RESTRICT)", async () => {
    // The one Post child the convention deliberately left RESTRICT. It is why the
    // route can still fail after the gate, and why that failure is correct: a
    // recurring schedule whose template vanished would publish nothing forever.
    await prisma.recurringPost.create({
      data: {
        accountId,
        projectId,
        templatePostId: postId,
        name: `cascade-${randomUUID()}`,
        cronExpression: "0 0 * * *",
        startDate: new Date(),
        channels: [],
      },
    });

    await assert.rejects(
      () => prisma.post.deleteMany({ where: { id: { in: [postId] } } }),
      (error: unknown) => {
        const code = (error as { code?: string }).code;
        assert.equal(code, "P2003", `expected a foreign-key violation, got ${String(code)}`);
        return true;
      }
    );

    assert.equal(
      await prisma.post.count({ where: { id: postId } }),
      1,
      "a refused delete must leave the post intact"
    );

    await teardownFixture();
  });
});
