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
 * consuming the publish queue. Both halves are ENFORCED in `before`, not
 * merely documented here: a missing API and a queue with no consumer each
 * fail the suite in seconds, naming themselves. Tests fail loud rather than
 * skipping, per the canon "Never skip tests because services are down —
 * start them."
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
import { assertPublishConsumers, checkApiAvailable, getBaseUrl } from "../testUtils.js";
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
    // Both preconditions, concurrently and BEFORE the first fixture row: the two
    // share one setup budget, and a suite that creates rows before knowing its
    // environment leaves them behind when the environment turns out to be wrong.
    const [apiAvailable, consumers] = await Promise.all([
      checkApiAvailable(),
      assertPublishConsumers(),
    ]);

    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    // The publish cases below start a saga and wait for a terminal state. With
    // nothing consuming the publish queue the saga correctly PARKS, and its only
    // remaining terminalizer is the 30-minute horizon — so every one of them
    // burns its full per-test budget and then reports "did not reach terminal
    // state", which is a symptom several inference steps away from the cause.
    // Failing here instead states the cause, in seconds.
    assert.ok(consumers.ok, consumers.message);

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
        accountId: account.id,
        provider: "X",
        providerAccountId: `provider-acct-${tag}-1`,
        ...channelStub,
      },
    });
    const channel2 = await prisma.channel.create({
      data: {
        projectId: project.id,
        accountId: account.id,
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
    //
    // The budget is 120 s rather than 60 s because the terminal state now
    // arrives on the saga's own timing rather than on its retry budget: a
    // waiting step re-arms on the 30 s poll cadence, so when the worker's
    // completion event races BullMQ's state update the saga waits one poll
    // before it can see the outcome. Measured on this environment: ~60 s to
    // FAILED with the real cause. The old 60 s budget was calibrated to the
    // amplification-era behavior, where the saga gave up after burning three
    // retries — which is exactly the defect this suite must no longer rely on.
    const final = await waitForTerminal(fixture.authHeader, startBody.data.sagaId, 120_000);
    assert.ok(
      ["COMPLETED", "FAILED"].includes(final.status),
      `expected terminal COMPLETED or FAILED, got ${final.status}`
    );
  });

  it("reports a multi-channel publish on the existing status surface, in the three-state contract", async () => {
    // The customer-facing correction, asserted where the WRONG outcome used to
    // be read: this endpoint. Two channels, so the saga's wait step is
    // re-entered by a sibling's completion event — the exact shape that used to
    // spend the retry budget until a fully-published post reported FAILED.
    const start = await startSaga(fixture.authHeader, {
      mode: "publish-now",
      projectId: fixture.projectId,
      locale: "en",
      body: "multi-channel outcome body",
      channelIds: [fixture.channelIds[0]!, fixture.channelIds[1]!],
    });
    assert.strictEqual(start.status, 200);
    const startBody = start.body as { data: { sagaId: string } };

    // A longer budget than the single-channel scenario above, and the reason is
    // the change itself: a step that has not finished re-arms on the poll
    // cadence (30 s) instead of spending a retry, so when a completion event
    // races BullMQ's own state update — the job's last attempt has failed but
    // the job is not yet in the failed set — the saga waits one poll before it
    // sees the outcome. Measured here: ~60 s to a terminal FAILED carrying "2
    // out of 2 publishing jobs failed", of which one poll interval is the tail.
    // That latency is the designed cost of never spending budget on a step that
    // is merely waiting; events remain the primary advance.
    const final = await waitForTerminal(fixture.authHeader, startBody.data.sagaId, 120_000);

    // Whatever the dev provider credentials do, ONE outcome is now impossible:
    // a saga ended because its own siblings were still publishing. Without real
    // credentials the jobs genuinely fail, so a FAILED terminal is still valid
    // here — it just may never carry the amplification reason again.
    assert.doesNotMatch(
      String(final.data.error ?? ""),
      /still in progress/i,
      "no publish may end because its own channels had not finished yet"
    );

    // The corrected outcome is visible on the EXISTING surface: step results
    // carry the three-state discriminator, and a step still waiting on the
    // channels is reported as waiting rather than as one that failed. No new
    // surface, and no new customer message, was introduced for it.
    const stepResults = (final.data.stepResults ?? []) as {
      outcome?: string;
      success?: unknown;
    }[];
    assert.ok(stepResults.length > 0, "the status surface reports the steps it ran");
    for (const result of stepResults) {
      assert.ok(
        ["succeeded", "failed", "waiting"].includes(String(result.outcome)),
        `every step outcome is one of the three states, got ${String(result.outcome)}`
      );
      assert.strictEqual(
        result.success,
        undefined,
        "and the boolean that could not tell 'waiting' from 'failed' is gone"
      );
    }
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
        accountId: foreignAccount.id,
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

    // That 35s retry envelope (5 + 10 + 20) NO LONGER EXISTS: a step waiting on
    // its publish jobs spends no retry budget, so this flow now ends on the
    // saga's own timing — the completion event, or one 30s poll interval behind
    // it when that event races the queue's state update. Measured on this
    // environment: ~60s to a terminal state. 120s, the same budget and the same
    // reason as the two publish-now scenarios above, keeps a full poll interval
    // of headroom; 90s left barely one, which is a flake waiting to happen.
    const final = await waitForTerminal(fixture.authHeader, sagaId, 120_000);
    const compensationResults =
      (final.data.compensationResults as Array<unknown> | undefined) ?? [];

    // Canon: only compensable steps strictly before pivotStepIndex (2) may
    // appear with a real compensation result. Steps 2-4 must NOT have been
    // compensated regardless of saga outcome.
    for (let i = 2; i < compensationResults.length; i++) {
      const result = compensationResults[i] as { outcome?: string } | undefined;
      assert.ok(
        result === undefined || result === null,
        `step ${i} (pivot/retryable) must not have a compensation result, got: ${JSON.stringify(result)}`
      );
    }
  });
});
