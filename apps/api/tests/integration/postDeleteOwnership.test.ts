/**
 * @file postDeleteOwnership.test.ts
 * @description Two-tenant real-DB integration test proving the DELETE /posts/:id
 *              ownership gate (CWE-639). A caller cannot delete a post owned by
 *              another account, a foreign id is byte-indistinguishable from a
 *              genuinely nonexistent id, the victim's post survives the attempt,
 *              and the explicit system caller (saga compensation) still deletes
 *              the post it owns.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { DeletePostUseCase } from "@core/posts";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

/**
 * Mints a customer Bearer token bound to the given account. The DELETE route
 * sits behind `requireClientAuth`; the ownership gate reads the account from
 * the verified token principal, so the token accountId is the caller identity.
 */
const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `post-delete-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

/**
 * Seeds a DRAFT post (with one content row so `findById` can reconstruct the
 * aggregate) under the given project and returns its id.
 */
const seedDraftPost = async (prisma: PrismaClient, projectId: string): Promise<string> => {
  const post = await prisma.post.create({
    data: {
      projectId,
      status: "DRAFT",
      contents: { create: { locale: "en", body: "seeded post body", tags: [] } },
    },
  });
  return post.id;
};

describe("DELETE /posts/:id ownership gate (CWE-639)", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  let accountAId: string;
  let accountBId: string;
  let projectAId: string;
  let projectBId: string;
  let bearerA: string;
  let bearerB: string;

  // Post owned by B, target of A's foreign-delete attempt (must survive).
  let foreignTargetPostId: string;
  // Post owned by B, used ONLY by the anti-enumeration parity case. It needs its
  // own untouched post: reusing the foreign-delete target would let this case pass
  // for the wrong reason — if the ownership gate were removed, that target would
  // already be soft-deleted by the previous case, so the 404 here would mean "gone"
  // instead of "not yours", and the parity assertion would go green on a broken gate.
  let antiEnumTargetPostId: string;
  // Post owned by B, deleted by its owner B (happy path).
  let ownerPostId: string;
  // Post owned by A, deleted through the explicit system caller.
  let systemPostId: string;

  before(async () => {
    prisma = createTestPrismaClient();

    const stamp = Date.now();
    const accountA = await prisma.account.create({
      data: { email: `post-delete-a-${stamp}@test.com`, name: "Post Delete Tenant A" },
    });
    const accountB = await prisma.account.create({
      data: { email: `post-delete-b-${stamp}@test.com`, name: "Post Delete Tenant B" },
    });
    accountAId = accountA.id;
    accountBId = accountB.id;
    bearerA = bearerFor(accountA.id);
    bearerB = bearerFor(accountB.id);

    const projectA = await prisma.project.create({
      data: { accountId: accountA.id, name: `Tenant A Project ${stamp}` },
    });
    const projectB = await prisma.project.create({
      data: { accountId: accountB.id, name: `Tenant B Project ${stamp}` },
    });
    projectAId = projectA.id;
    projectBId = projectB.id;

    foreignTargetPostId = await seedDraftPost(prisma, projectBId);
    antiEnumTargetPostId = await seedDraftPost(prisma, projectBId);
    ownerPostId = await seedDraftPost(prisma, projectBId);
    systemPostId = await seedDraftPost(prisma, projectAId);

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      const projectIds = [projectAId, projectBId];
      await prisma.postContent.deleteMany({ where: { post: { projectId: { in: projectIds } } } });
      await prisma.post.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.account.deleteMany({ where: { id: { in: [accountAId, accountBId] } } });
      await prisma.$disconnect();
    }
  });

  it("lets the owner delete its own post", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/posts/${ownerPostId}`,
      headers: { authorization: bearerB },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, data: { deleted: true } });

    const row = await prisma.post.findUnique({ where: { id: ownerPostId } });
    assert.ok(row, "owner post row still exists (soft delete)");
    assert.ok(row?.deletedAt, "owner post is soft-deleted (deletedAt set)");
  });

  it("returns 404 (not 403) when deleting another account's post and leaves it intact", async () => {
    const foreignRes = await app.inject({
      method: "DELETE",
      url: `/posts/${foreignTargetPostId}`,
      headers: { authorization: bearerA },
    });

    assert.equal(foreignRes.statusCode, 404, "foreign delete must be NOT_FOUND, never 200 or 403");

    // The victim's post must be untouched — not soft-deleted.
    const row = await prisma.post.findUnique({ where: { id: foreignTargetPostId } });
    assert.ok(row, "victim post row still present");
    assert.equal(row?.deletedAt, null, "victim post was NOT soft-deleted by the foreign caller");
  });

  it("makes a foreign post id byte-indistinguishable from a nonexistent id", async () => {
    const nonexistentId = randomUUID();

    const foreignRes = await app.inject({
      method: "DELETE",
      url: `/posts/${antiEnumTargetPostId}`,
      headers: { authorization: bearerA },
    });
    const nonexistentRes = await app.inject({
      method: "DELETE",
      url: `/posts/${nonexistentId}`,
      headers: { authorization: bearerA },
    });

    assert.equal(foreignRes.statusCode, 404);
    assert.equal(nonexistentRes.statusCode, 404);
    // Identical status AND body shape — no enumeration signal.
    assert.deepEqual(foreignRes.json(), nonexistentRes.json());

    // Pins WHY the foreign id 404s: the ownership gate refused it, not absence.
    // Without this, a broken gate that deleted the post would still 404 on a
    // second call and the parity assertion above would pass on a real hole.
    const row = await prisma.post.findUnique({ where: { id: antiEnumTargetPostId } });
    assert.ok(row, "anti-enumeration target row still present");
    assert.equal(row?.deletedAt, null, "the 404 came from the gate, not from a prior delete");
  });

  it("lets the explicit system caller delete the post it owns (gate skipped)", async () => {
    const deletePostUseCase = app.container!.resolve<DeletePostUseCase>(TOKENS.DeletePostUseCase);

    const result = await deletePostUseCase.execute({
      postId: systemPostId,
      caller: { type: "system", source: "PostPublishingSaga:Compensation" },
    });

    assert.ok(result.ok, "system caller delete should succeed");

    const row = await prisma.post.findUnique({ where: { id: systemPostId } });
    assert.ok(row?.deletedAt, "system-deleted post is soft-deleted (deletedAt set)");
  });
});
