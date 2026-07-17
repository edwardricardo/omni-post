/**
 * @file postReadOwnership.test.ts
 * @description Two-tenant real-DB integration test proving the post READ ownership
 *              gate (CWE-639) across all four mounted customer read surfaces. Account
 *              A cannot get/thread account B's post (NOT_FOUND, byte-identical to a
 *              nonexistent id, never 403), a by-project list for B's project returns
 *              no B posts, and the unfiltered global list as A returns only A's posts.
 *              A mocked unit test cannot detect a missing ownership filter — only a
 *              real DB + HTTP path can.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

/**
 * Mints a customer Bearer token bound to the given account. Every post read route
 * sits behind `requireClientAuth`; the ownership gate reads the account from the
 * verified token principal, so the token accountId is the caller identity.
 */
const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `post-read-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

/**
 * Seeds a DRAFT post (with one content row so the read model has a body) under the
 * given project and returns its id.
 */
const seedPost = async (prisma: PrismaClient, projectId: string, body: string): Promise<string> => {
  const post = await prisma.post.create({
    data: {
      projectId,
      status: "DRAFT",
      contents: { create: { locale: "en", body, tags: [] } },
    },
  });
  return post.id;
};

describe("GET /posts read ownership gate (CWE-639)", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  let accountAId: string;
  let accountBId: string;
  let projectAId: string;
  let projectBId: string;
  let bearerA: string;
  let bearerB: string;

  // Account A owns two posts across its single project.
  let postA1Id: string;
  let postA2Id: string;
  // Account B owns one post — the target of A's cross-tenant read attempts.
  let postB1Id: string;

  before(async () => {
    prisma = createTestPrismaClient();

    const stamp = Date.now();
    const accountA = await prisma.account.create({
      data: { email: `post-read-a-${stamp}@test.com`, name: "Post Read Tenant A" },
    });
    const accountB = await prisma.account.create({
      data: { email: `post-read-b-${stamp}@test.com`, name: "Post Read Tenant B" },
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

    postA1Id = await seedPost(prisma, projectAId, "tenant A post one");
    postA2Id = await seedPost(prisma, projectAId, "tenant A post two");
    postB1Id = await seedPost(prisma, projectBId, "tenant B secret post");

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

  // ── Single-post read (R1, R2) ──────────────────────────────────────────────

  it("lets the owner read its own post", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/posts/${postB1Id}`,
      headers: { authorization: bearerB },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { id: string; body: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.id, postB1Id);
    assert.equal(body.data.body, "tenant B secret post");
  });

  it("returns 404 (not 403) when reading another account's post and never exposes it", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/posts/${postB1Id}`,
      headers: { authorization: bearerA },
    });

    assert.equal(res.statusCode, 404, "foreign read must be NOT_FOUND, never 200 or 403");
    const body = res.json() as { ok: boolean; data?: unknown };
    assert.equal(body.ok, false);
    assert.equal(body.data, undefined, "no post payload leaks on a foreign read");

    // The victim's post must remain readable to its owner (untouched).
    const ownerRes = await app.inject({
      method: "GET",
      url: `/posts/${postB1Id}`,
      headers: { authorization: bearerB },
    });
    assert.equal(ownerRes.statusCode, 200, "B's post is still readable by B");
  });

  it("makes a foreign post id byte-indistinguishable from a nonexistent id", async () => {
    const nonexistentId = randomUUID();

    const foreignRes = await app.inject({
      method: "GET",
      url: `/posts/${postB1Id}`,
      headers: { authorization: bearerA },
    });
    const nonexistentRes = await app.inject({
      method: "GET",
      url: `/posts/${nonexistentId}`,
      headers: { authorization: bearerA },
    });

    assert.equal(foreignRes.statusCode, 404);
    assert.equal(nonexistentRes.statusCode, 404);
    // Identical status AND body shape — no enumeration signal, never 403.
    assert.deepEqual(foreignRes.json(), nonexistentRes.json());
  });

  // ── By-project list (R3) ───────────────────────────────────────────────────

  it("returns an empty list for a project owned by another account", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/posts?projectId=${projectBId}`,
      headers: { authorization: bearerA },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { data: Array<{ id: string }> } };
    assert.equal(body.ok, true);
    assert.deepEqual(
      body.data.data,
      [],
      "A must receive no posts from B's project (empty, never B's rows)"
    );
  });

  it("lets the owner list its own project's posts", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/posts?projectId=${projectAId}`,
      headers: { authorization: bearerA },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      data: { data: Array<{ id: string; projectId: string }> };
    };
    const ids = body.data.data.map((p) => p.id).sort();
    assert.deepEqual(
      ids,
      [postA1Id, postA2Id].sort(),
      "owner sees exactly its own project's posts"
    );
  });

  // ── Global unfiltered list (R4) ────────────────────────────────────────────

  it("scopes the unfiltered global list to the caller account (never leaks other accounts)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/posts`,
      headers: { authorization: bearerA },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      data: { data: Array<{ id: string; projectId: string }> };
    };
    const items = body.data.data;
    const ids = items.map((p) => p.id).sort();

    // Account A was freshly seeded with exactly its two posts, so the global list
    // returns only those — never B's post.
    assert.deepEqual(ids, [postA1Id, postA2Id].sort(), "A's global list is exactly A's own posts");
    assert.ok(!ids.includes(postB1Id), "B's post must never appear in A's global list");
    for (const item of items) {
      assert.equal(item.projectId, projectAId, "every returned post belongs to account A");
    }
  });
});
