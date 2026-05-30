/**
 * Integration Tests — Customer Post-Publishing Saga
 *
 * Exercises the full HTTP request/response cycle for
 * `POST /sagas/post-publishing/start` and `GET /sagas/:sagaId` against a
 * real API + Postgres + Redis (and workers, for publish-now). Coverage:
 *   - 3 modes (draft, schedule, publish-now)
 *   - existing-post (postId) and from-scratch (content) variants
 *   - cross-tenant ownership rejections (project, channel, post)
 *   - XOR refinement (postId AND content rejected)
 *   - status endpoint ownership (anti-IDOR)
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000, workers
 * consuming the publish queue. Tests fail loud if anything is missing
 * (rather than skipping) per the canon "Never skip tests because services
 * are down — start them."
 *
 * @file sagaCustomerFlow.test.ts
 * @description Tests for the customer-facing saga endpoint
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

interface Fixture {
  accountId: string;
  customerUserId: string;
  projectId: string;
  channelIds: string[];
  draftPostId: string;
  publishedPostId: string;
  /** Bearer token for customerUserId; valid for 15 min */
  authHeader: string;
  /** Bearer token whose accountId points at a DIFFERENT account — used for
   * cross-tenant ownership checks */
  otherAccountAuthHeader: string;
}

async function startSaga(authHeader: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/sagas/post-publishing/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

async function getSagaStatus(authHeader: string, sagaId: string) {
  const response = await fetch(`${API_URL}/sagas/${sagaId}`, {
    headers: { Authorization: authHeader },
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

/**
 * Polls the saga until it reaches a terminal state or hits maxMs. Test code
 * uses this for assertions that depend on saga completion (draft + schedule
 * modes complete in <1s in dev).
 */
async function waitForTerminal(
  authHeader: string,
  sagaId: string,
  maxMs = 15_000
): Promise<{ status: string; data: Record<string, unknown> }> {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "COMPENSATED"]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const result = await getSagaStatus(authHeader, sagaId);
    if (result.status === 200) {
      const body = result.body as { data?: { status?: string } };
      const sagaStatus = body?.data?.status;
      if (sagaStatus && TERMINAL.has(sagaStatus)) {
        return { status: sagaStatus, data: body.data as Record<string, unknown> };
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Saga ${sagaId} did not reach terminal state within ${maxMs}ms`);
}

describe("Saga customer flow integration", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `saga-int-${Date.now()}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Saga Integration Account" },
    });

    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Saga",
        lastName: "Tester",
      },
    });

    const project = await prisma.project.create({
      data: { accountId: account.id, name: `Saga Project ${tag}` },
    });

    // Two channels so we can test multi-channel publishes. The encrypted-
    // credential columns are populated with placeholder strings — the saga
    // path doesn't decrypt them; only the worker pipeline does, and the
    // publish-now test accepts a FAILED terminal as valid (no real creds).
    const channelStub = {
      handle: "test-handle",
      credentialsCiphertext: "test-ciphertext",
      credentialsIv: "test-iv",
      credentialsAuthTag: "test-auth-tag",
    } as const;
    const channel1 = await prisma.channel.create({
      data: {
        projectId: project.id,
        provider: "X",
        providerAccountId: `provider-acct-${tag}-1`,
        ...channelStub,
      },
    });
    const channel2 = await prisma.channel.create({
      data: {
        projectId: project.id,
        provider: "FACEBOOK",
        providerAccountId: `provider-acct-${tag}-2`,
        ...channelStub,
      },
    });

    const draftPost = await prisma.post.create({
      data: {
        projectId: project.id,
        status: "DRAFT",
      },
    });
    await prisma.postContent.create({
      data: { postId: draftPost.id, locale: "en", revision: 1, body: "draft body" },
    });

    const publishedPost = await prisma.post.create({
      data: {
        projectId: project.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    await prisma.postContent.create({
      data: { postId: publishedPost.id, locale: "en", revision: 1, body: "published body" },
    });

    // Cross-tenant fixture: a SECOND account whose token must be rejected
    // when targeting the first account's project / post / channel.
    const otherAccount = await prisma.account.create({
      data: { email: `other-${tag}@test.com`, name: "Cross-tenant Account" },
    });
    const otherCustomerUser = await prisma.customerUser.create({
      data: {
        accountId: otherAccount.id,
        email: `other-customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Other",
        lastName: "Tester",
      },
    });

    const accessToken = signCustomerAccessToken({
      sub: customerUser.id,
      accountId: account.id,
      role: "OWNER",
    });
    const otherAccessToken = signCustomerAccessToken({
      sub: otherCustomerUser.id,
      accountId: otherAccount.id,
      role: "OWNER",
    });

    fixture = {
      accountId: account.id,
      customerUserId: customerUser.id,
      projectId: project.id,
      channelIds: [channel1.id, channel2.id],
      draftPostId: draftPost.id,
      publishedPostId: publishedPost.id,
      authHeader: `Bearer ${accessToken}`,
      otherAccountAuthHeader: `Bearer ${otherAccessToken}`,
    };
  });

  after(async () => {
    if (!fixture) return;

    try {
      // Best-effort cascade cleanup; FK constraints handle the rest.
      await prisma.sagaInstance.deleteMany({
        where: { context: { path: ["userId"], equals: fixture.customerUserId } as never },
      });
      // Cleanup applies to ALL posts in the project — sagas that ran during
      // the suite created additional posts beyond the two fixture posts, and
      // each has a PostContent that the FK constraint requires we drop first.
      const projectPosts = await prisma.post.findMany({
        where: { projectId: fixture.projectId },
        select: { id: true },
      });
      const projectPostIds = projectPosts.map((p) => p.id);
      if (projectPostIds.length > 0) {
        await prisma.postContent.deleteMany({ where: { postId: { in: projectPostIds } } });
        await prisma.publishLog.deleteMany({ where: { postId: { in: projectPostIds } } });
      }
      await prisma.post.deleteMany({ where: { projectId: fixture.projectId } });
      await prisma.channel.deleteMany({ where: { projectId: fixture.projectId } });
      await prisma.project.deleteMany({ where: { id: fixture.projectId } });
      await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
      await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // mode = draft
  // -----------------------------------------------------------------------

  it("creates a draft (mode=draft) and reaches COMPLETED", async () => {
    const start = await startSaga(fixture.authHeader, {
      mode: "draft",
      projectId: fixture.projectId,
      locale: "en",
      body: "saga integration draft body",
      title: "Saga Integration Draft",
    });
    assert.strictEqual(start.status, 200);
    const startBody = start.body as { data: { sagaId: string; mode: string } };
    assert.ok(startBody.data.sagaId, "sagaId returned");
    assert.strictEqual(startBody.data.mode, "draft");

    const final = await waitForTerminal(fixture.authHeader, startBody.data.sagaId);
    assert.strictEqual(final.status, "COMPLETED");

    // Step 1 (Create) carries the new postId in stepResults.
    const stepResults = (final.data.stepResults as Array<{ data?: { postId?: string } }>) || [];
    const createdPostId = stepResults[1]?.data?.postId;
    assert.ok(createdPostId, "create step recorded postId");

    // The Post must be persisted as DRAFT.
    const post = await prisma.post.findUnique({ where: { id: createdPostId } });
    assert.ok(post, "post persisted");
    assert.strictEqual(post.status, "DRAFT");
    assert.strictEqual(post.projectId, fixture.projectId);
  });

  // -----------------------------------------------------------------------
  // mode = schedule + existing draft (postId path)
  // -----------------------------------------------------------------------

  it("schedules an existing draft (mode=schedule + postId) and skips Create step", async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const start = await startSaga(fixture.authHeader, {
      mode: "schedule",
      projectId: fixture.projectId,
      postId: fixture.draftPostId,
      channelIds: [fixture.channelIds[0]!],
      scheduledAt,
    });
    assert.strictEqual(start.status, 200);
    const startBody = start.body as { data: { sagaId: string } };
    const sagaId = startBody.data.sagaId;

    const final = await waitForTerminal(fixture.authHeader, sagaId);
    assert.strictEqual(final.status, "COMPLETED");

    const stepResults =
      (final.data.stepResults as Array<{
        data?: { postId?: string; skippedCreation?: boolean };
      }>) || [];
    // Create step (index 1) MUST flag skippedCreation since postId was provided.
    assert.strictEqual(stepResults[1]?.data?.skippedCreation, true);
    assert.strictEqual(stepResults[1]?.data?.postId, fixture.draftPostId);
  });

  // -----------------------------------------------------------------------
  // mode = publish-now + new content
  // -----------------------------------------------------------------------

  it("runs publish-now end-to-end through the worker pipeline", async () => {
    const start = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      locale: "en",
      body: "publish-now integration body",
      channelIds: [fixture.channelIds[0]!],
    });
    assert.strictEqual(start.status, 200);
    const startBody = start.body as { data: { sagaId: string } };

    // Worker pipeline drives Wait + UpdateStatus. Without real OAuth
    // credentials the provider call fails, the worker emits
    // `publish.job.failed`, and the saga finalises Post.status to FAILED —
    // both COMPLETED and FAILED terminal states are valid signals here. The
    // assertion is that the saga DOES reach a terminal state, not that the
    // dev provider creds happen to be wired.
    const final = await waitForTerminal(fixture.authHeader, startBody.data.sagaId, 60_000);
    assert.ok(
      ["COMPLETED", "FAILED"].includes(final.status),
      `expected terminal COMPLETED or FAILED, got ${final.status}`
    );
  });

  // -----------------------------------------------------------------------
  // Negative — Zod refinement (XOR)
  // -----------------------------------------------------------------------

  it("rejects body with both postId AND content (XOR refinement)", async () => {
    const result = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      postId: fixture.draftPostId,
      locale: "en",
      body: "should not be here",
      channelIds: [fixture.channelIds[0]!],
    });
    assert.strictEqual(result.status, 400);
  });

  it("rejects body with neither postId nor content", async () => {
    const result = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      channelIds: [fixture.channelIds[0]!],
    });
    assert.strictEqual(result.status, 400);
  });

  // -----------------------------------------------------------------------
  // Negative — ownership (cross-tenant)
  // -----------------------------------------------------------------------

  it("returns 404 when projectId belongs to another account", async () => {
    const result = await startSaga(fixture.otherAccountAuthHeader, {
      mode: "draft",
      projectId: fixture.projectId, // belongs to fixture.accountId, NOT otherAccount
      locale: "en",
      body: "cross-tenant attempt",
    });
    assert.strictEqual(result.status, 404, "cross-tenant project must 404 (anti-IDOR)");
  });

  it("returns 404 when postId belongs to another project", async () => {
    // Create a post in a project the test account does NOT own.
    const foreignAccount = await prisma.account.create({
      data: { email: `foreign-${randomUUID()}@test.com`, name: "Foreign Account" },
    });
    const foreignProject = await prisma.project.create({
      data: { accountId: foreignAccount.id, name: "Foreign project" },
    });
    const foreignPost = await prisma.post.create({
      data: { projectId: foreignProject.id, status: "DRAFT" },
    });

    try {
      const result = await startSaga(fixture.authHeader, {
        mode: "publish-now",
        projectId: fixture.projectId, // owned by test account
        postId: foreignPost.id, // belongs to foreign project
        channelIds: [fixture.channelIds[0]!],
      });
      assert.strictEqual(result.status, 404, "post in another project must 404");
    } finally {
      await prisma.post.deleteMany({ where: { id: foreignPost.id } });
      await prisma.project.deleteMany({ where: { id: foreignProject.id } });
      await prisma.account.deleteMany({ where: { id: foreignAccount.id } });
    }
  });

  it("rejects scheduling an already PUBLISHED post (must be DRAFT)", async () => {
    const result = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      postId: fixture.publishedPostId, // PUBLISHED, not DRAFT
      channelIds: [fixture.channelIds[0]!],
    });
    assert.strictEqual(result.status, 400);
  });

  // -----------------------------------------------------------------------
  // Negative — channel ownership
  // -----------------------------------------------------------------------

  it("returns 404 when channelId belongs to another project", async () => {
    const foreignAccount = await prisma.account.create({
      data: { email: `chan-${randomUUID()}@test.com`, name: "Foreign Channel Account" },
    });
    const foreignProject = await prisma.project.create({
      data: { accountId: foreignAccount.id, name: "Foreign Channel Project" },
    });
    const foreignChannel = await prisma.channel.create({
      data: {
        projectId: foreignProject.id,
        provider: "X",
        handle: "foreign-handle",
        providerAccountId: `prov-${randomUUID()}`,
        credentialsCiphertext: "test-ciphertext",
        credentialsIv: "test-iv",
        credentialsAuthTag: "test-auth-tag",
      },
    });

    try {
      const result = await startSaga(fixture.authHeader, {
        mode: "publish-now",
        projectId: fixture.projectId,
        locale: "en",
        body: "wrong channel",
        channelIds: [foreignChannel.id],
      });
      assert.strictEqual(result.status, 404);
    } finally {
      await prisma.channel.deleteMany({ where: { id: foreignChannel.id } });
      await prisma.project.deleteMany({ where: { id: foreignProject.id } });
      await prisma.account.deleteMany({ where: { id: foreignAccount.id } });
    }
  });

  // -----------------------------------------------------------------------
  // Negative — auth
  // -----------------------------------------------------------------------

  it("returns 401 when Authorization header is missing", async () => {
    const response = await fetch(`${API_URL}/sagas/post-publishing/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "draft",
        projectId: fixture.projectId,
        locale: "en",
        body: "no auth",
      }),
    });
    assert.strictEqual(response.status, 401);
  });

  // -----------------------------------------------------------------------
  // Status endpoint ownership
  // -----------------------------------------------------------------------

  it("returns 404 from GET /sagas/:sagaId for a saga owned by another customer", async () => {
    // Start a saga as account A
    const start = await startSaga(fixture.authHeader, {
      mode: "draft",
      projectId: fixture.projectId,
      locale: "en",
      body: "ownership-check draft",
    });
    assert.strictEqual(start.status, 200);
    const sagaId = (start.body as { data: { sagaId: string } }).data.sagaId;

    // Read it as account B → 404 (anti-IDOR)
    const result = await getSagaStatus(fixture.otherAccountAuthHeader, sagaId);
    assert.strictEqual(result.status, 404);
  });

  // -----------------------------------------------------------------------
  // Canon coverage — OCC (Azure saga §15-20)
  // -----------------------------------------------------------------------

  it("rejects PATCH /posts/:id with stale expectedVersion (CONFLICT)", async () => {
    // Create a fresh post via the saga so we know its starting version (0).
    const start = await startSaga(fixture.authHeader, {
      mode: "draft",
      projectId: fixture.projectId,
      locale: "en",
      body: "OCC test draft",
    });
    assert.strictEqual(start.status, 200);
    const final = await waitForTerminal(
      fixture.authHeader,
      (start.body as { data: { sagaId: string } }).data.sagaId
    );
    assert.strictEqual(final.status, "COMPLETED");
    const stepResults = final.data.stepResults as Array<{ data?: { postId?: string } }>;
    const postId = stepResults[1]?.data?.postId;
    assert.ok(postId, "post created via saga");

    // Mutate the post once to bump its version to 1. Body avoids "update"
    // and other SQL keywords — SecureSchemas.postBody runs SecurityValidator
    // which flags those as injection threats and rejects the request before
    // the use case sees it.
    const firstUpdate = await fetch(`${API_URL}/posts/${postId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: fixture.authHeader,
      },
      body: JSON.stringify({ body: "revised content one" }),
    });
    assert.strictEqual(firstUpdate.status, 200);

    // Attempt a second update with a stale expectedVersion=0; the use case
    // must reject with CONFLICT because the persisted version is now 1.
    const staleUpdate = await fetch(`${API_URL}/posts/${postId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: fixture.authHeader,
      },
      body: JSON.stringify({ body: "revised content two", expectedVersion: 0 }),
    });
    assert.strictEqual(
      staleUpdate.status,
      409,
      "stale expectedVersion must surface as CONFLICT (409)"
    );
  });

  // -----------------------------------------------------------------------
  // Canon coverage — pivot semantics (Azure §5)
  // -----------------------------------------------------------------------

  it("does NOT compensate steps at or after the pivot when saga fails post-pivot", async () => {
    // The post-publishing-saga has pivotStepIndex=2 (Schedule). Steps 0-1 are
    // compensable, step 2 is pivot, steps 3-4 are retryable. We force a
    // failure post-pivot by starting publish-now with channels whose
    // credentials are stubs — the worker pipeline will reject them. The
    // saga should reach a terminal FAILED state without compensating step 2
    // (no cancelJob) and without compensating steps 3-4 (retryable, no
    // compensate by canon).

    const start = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      channelIds: [fixture.channelIds[0]!],
      locale: "en",
      body: "pivot enforcement scenario",
    });
    assert.strictEqual(start.status, 200);
    const sagaId = (start.body as { data: { sagaId: string } }).data.sagaId;

    // 30s gives the worker pipeline + retries time to settle on a terminal
    // state. publish-now with stubbed creds typically reaches FAILED quickly,
    // but BullMQ retry policy adds latency.
    const final = await waitForTerminal(fixture.authHeader, sagaId, 30_000);
    const compensationResults =
      (final.data.compensationResults as Array<unknown> | undefined) ?? [];

    // Canon: only compensable steps strictly before pivotStepIndex (2) may
    // appear with a real compensation result. Steps 2-4 must NOT have been
    // compensated regardless of saga outcome.
    for (let i = 2; i < compensationResults.length; i++) {
      const result = compensationResults[i] as { success?: boolean } | undefined;
      assert.ok(
        result === undefined || result === null,
        `step ${i} (pivot/retryable) must not have a compensation result, got: ${JSON.stringify(result)}`
      );
    }
  });
});
