/**
 * Publish Flow Integration Test
 *
 * Tests the critical publish path end-to-end:
 *   create post in DB → create channel → open a publication episode →
 *   invoke PublishHandler → verify what the publication record and its mirror hold
 *
 * Uses real PostgreSQL + Redis (via setupTest) with mock provider adapters
 * from the workers test helpers.
 *
 * The episode is part of the flow, not scaffolding around it: the worker reads the
 * publication record before it calls a provider and writes the outcome back to it, so a
 * job whose episode nobody opened is refused before anything is sent. The record is also
 * where idempotency lives now — the `publish_log` row is a best-effort receipt mirror,
 * written only on success and keyed by the job id with its episode suffix removed.
 *
 * @file publish.flow.test.ts
 * @description Tests for Publish Flow
 * @layer infrastructure
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { setupTest, TestContext } from "./setup.js";
import { PublishHandler } from "../../../apps/workers/src/publishHandler.js";
import {
  createMockProvider,
  createMockInstrumentation,
  createMockDatabaseInstrumentation,
  createMockBusinessKPITracker,
  createTestWorkerMetrics,
  createSilentLogger,
} from "../../../apps/workers/tests/setup.js";
import type {
  PublishRepo,
  PublishProvider,
} from "../../../apps/workers/src/publishHandlerTypes.js";
import type { CanonicalPost, Result } from "@shared/types";
import { mintPublishJobId, readPublishJobId } from "@shared/types";
import { PUBLICATION_OUTCOME_KINDS } from "@core/domain/index.js";
import { createSeedPrismaClient } from "./integration/helpers/seedPrismaClient.js";
import {
  createPublishWorkerHarness,
  type PublishWorkerHarness,
} from "./integration/helpers/publishWorkerHarness.js";

/**
 * Fixture channel. The subject is the publish path end to end; this client plants the post and
 * channel it publishes and reads the PublishLog back.
 */
const prisma = createSeedPrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ts = Date.now();

/**
 * Creates a PublishRepo adapter that wraps ctx.repo for the PublishHandler.
 */
function createPublishRepoFromCtx(ctx: TestContext): PublishRepo {
  const repo = ctx.repo;

  return {
    logPublish: async (input) => {
      return (await repo.logPublish(input)) as Result<unknown, string>;
    },
    getPostById: async (id: string) => {
      return (await repo.getPostById(id)) as Result<CanonicalPost, string>;
    },
    // Thread methods — stubbed for single-post flow
    createThread: async () =>
      ({
        ok: true,
        value: {
          id: "stub",
          postId: "",
          strategy: "AUTO",
          tweets: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }) as any,
    getThreadByPostId: async () => ({ ok: true, value: null }) as any,
    getTweetsByThread: async () => ({ ok: true, value: [] }) as any,
    createTweet: async () => ({ ok: true, value: {} }) as any,
    updateTweet: async () => ({ ok: true, value: {} }) as any,
  };
}

function buildHandler(
  ctx: TestContext,
  provider: PublishProvider,
  harness: PublishWorkerHarness
): PublishHandler {
  return new PublishHandler({
    repo: createPublishRepoFromCtx(ctx),
    providerRegistry: { x: provider },
    // PublishHandler resolves channel credentials before invoking the provider;
    // the mock provider ignores them, so a static success resolver is enough.
    credentialResolver: {
      resolve: async () => ({ ok: true, value: { accessToken: "test-token" } }),
    },
    workerMetrics: createTestWorkerMetrics(),
    logger: createSilentLogger(),
    instrumentation: createMockInstrumentation(),
    databaseInstrumentation: createMockDatabaseInstrumentation(),
    businessKPITracker: createMockBusinessKPITracker(),
    // The record path is REAL: a double here would report a green publish over a
    // record nothing wrote, which is the state the record exists to make impossible.
    outcomeRecorder: harness.outcomeRecorder,
    publicationRecord: harness.publicationRecord,
  });
}

// ---------------------------------------------------------------------------
// Shared state — created once, cleaned up in after()
// ---------------------------------------------------------------------------

let accountId: string;
let projectId: string;
let channelId: string;
const postIds: string[] = [];
const jobIds: string[] = [];

describe("Publish Flow", { concurrency: 1 }, () => {
  let ctx: TestContext;
  const harness: PublishWorkerHarness = createPublishWorkerHarness(prisma);

  /**
   * Plants a post, opens a publication episode over the fixture channel and mints the
   * job id that episode is addressed by — the three things a publish job needs before
   * the worker will look at it.
   */
  async function seedJob(body: string): Promise<{ postId: string; jobId: string }> {
    const post = await ctx.repo.createPost({ projectId, locale: "es" as const, body });
    assert.ok(post.ok, `Create post: ${post.ok ? "" : post.error}`);
    postIds.push(post.value.id);

    const episode = await harness.openEpisode({
      accountId,
      postId: post.value.id,
      channelIds: [channelId],
    });
    const jobId = mintPublishJobId({ postId: post.value.id, channelId, episode });
    jobIds.push(jobId);
    return { postId: post.value.id, jobId };
  }

  /** The mirror row key for a job id, read back through the worker's own reader. */
  function mirrorKeyOf(jobId: string): string {
    const identity = readPublishJobId(jobId);
    assert.ok(identity, "a minted job id must name an episode");
    return identity.mirrorKey;
  }

  after(async () => {
    // Cleanup in FK-safe order: logs → publication records → posts → channels →
    // projects → accounts
    for (const jobId of jobIds) {
      try {
        await prisma.publishLog.deleteMany({ where: { dedupeKey: mirrorKeyOf(jobId) } });
      } catch {
        /* ignore */
      }
    }
    for (const pid of postIds) {
      try {
        await prisma.publishLog.deleteMany({ where: { postId: pid } });
      } catch {
        /* ignore */
      }
      try {
        await prisma.postChannelPublication.deleteMany({ where: { postId: pid } });
      } catch {
        /* ignore */
      }
      try {
        await prisma.post.delete({ where: { id: pid } });
      } catch {
        /* ignore */
      }
    }
    if (channelId) {
      try {
        await prisma.channel.delete({ where: { id: channelId } });
      } catch {
        /* ignore */
      }
    }
    if (projectId) {
      try {
        await prisma.project.delete({ where: { id: projectId } });
      } catch {
        /* ignore */
      }
    }
    if (accountId) {
      try {
        await prisma.account.delete({ where: { id: accountId } });
      } catch {
        /* ignore */
      }
    }
  });

  it("setup: create account, project, and channel", async () => {
    ctx = await setupTest();

    const account = await ctx.repo.createAccount({
      email: `publish-flow-${ts}@example.com`,
      name: "Publish Flow Account",
      subscription: "PRO",
    });
    assert.ok(account.ok, `Create account: ${account.ok ? "" : account.error}`);
    accountId = account.value.id;

    const project = await ctx.repo.createProject(accountId, {
      name: "publish-flow-project",
      locale: "es",
    });
    assert.ok(project.ok, `Create project: ${project.ok ? "" : project.error}`);
    projectId = project.value.id;

    // Create a real Channel in the DB (PublishLog has FK to Channel).
    // Credentials are stored as an AES-256-GCM envelope (ciphertext/iv/authTag),
    // not a plaintext JSON blob — match the current Channel schema.
    const channel = await prisma.channel.create({
      data: {
        projectId,
        accountId,
        provider: "X",
        handle: `@publish-flow-${ts}`,
        credentialsCiphertext: "test-ciphertext",
        credentialsIv: "test-iv",
        credentialsAuthTag: "test-auth-tag",
      },
    });
    channelId = channel.id;
  });

  it("happy path: publish single post and verify PublishLog OK", async () => {
    ctx = await setupTest();

    const { postId, jobId } = await seedJob("Hello from publish flow test!");
    const handler = buildHandler(ctx, createMockProvider(), harness);

    await handler.handleJob({
      payload: { postId, channelId, accountId, provider: "x" },
      dedupeKey: jobId,
      attemptsMade: 0,
    });

    // Verify PublishLog. The mirror is keyed by the job id with its episode
    // suffix removed — one receipt row per (post, channel), whatever episode
    // wrote it.
    const logs = await prisma.publishLog.findMany({
      where: { dedupeKey: mirrorKeyOf(jobId) },
      orderBy: { createdAt: "desc" },
    });

    const okLog = logs.find((l) => l.status === "OK");
    assert.ok(okLog, "Should have an OK PublishLog entry");
    assert.strictEqual(okLog.provider, "X");
    assert.strictEqual(okLog.channelId, channelId);

    // And the record the mirror mirrors: the publication itself is what the saga
    // settles on, so a green mirror over an unwritten record would be a lie.
    const record = await harness.readChannelRecord({ accountId, postId, channelId });
    assert.ok(record, "the publication record must hold this channel");
    assert.strictEqual(record.outcomeKind, PUBLICATION_OUTCOME_KINDS.PUBLISHED);
  });

  it("provider failure: the attempt is recorded and nothing is mirrored", async () => {
    ctx = await setupTest();

    const { postId, jobId } = await seedJob("This post will fail to publish");

    // Mock provider that fails on publish
    const failingProvider: PublishProvider = {
      ...createMockProvider(),
      publish: async () => ({
        ok: false as const,
        error: { code: "RATE_LIMIT", message: "Too many requests" },
      }),
    };

    const handler = buildHandler(ctx, failingProvider, harness);

    // handleJob records the failed attempt and then re-throws while the channel is
    // still unresolved, so BullMQ's retry policy can take effect.
    await assert.rejects(
      handler.handleJob({
        payload: { postId, channelId, accountId, provider: "x" },
        dedupeKey: jobId,
        attemptsMade: 0,
      })
    );

    // A failure leaves NO publish_log row: the mirror is written only after a
    // provider has accepted content, so the record is the only place a failure is
    // legible, and it is where this asserts.
    const record = await harness.readChannelRecord({ accountId, postId, channelId });
    assert.ok(record, "the publication record must hold this channel");
    assert.strictEqual(record.outcomeKind, PUBLICATION_OUTCOME_KINDS.UNRESOLVED);
    assert.strictEqual(record.attempts, 1, "the failed attempt must be counted");
    assert.ok(record.lastFailure, "the failure cause must be kept on the record");

    const logs = await prisma.publishLog.findMany({
      where: { dedupeKey: mirrorKeyOf(jobId) },
    });
    assert.strictEqual(logs.length, 0, "a failed attempt mirrors no receipt");
  });

  it("idempotency: a replayed job publishes nothing a second time", async () => {
    ctx = await setupTest();

    const { postId, jobId } = await seedJob("Already published post");

    // Track provider.publish calls
    let publishCalled = false;
    const trackingProvider: PublishProvider = {
      ...createMockProvider(),
      publish: async (input) => {
        publishCalled = true;
        return createMockProvider().publish(input);
      },
    };

    // Publish once for real, so what the replay meets is the record the first run
    // wrote — not a row planted to look like one.
    await buildHandler(ctx, createMockProvider(), harness).handleJob({
      payload: { postId, channelId, accountId, provider: "x" },
      dedupeKey: jobId,
      attemptsMade: 0,
    });

    // The same job id again, as a BullMQ redelivery hands it over. The record now
    // says this channel already published, so the provider must never be reached.
    await buildHandler(ctx, trackingProvider, harness).handleJob({
      payload: { postId, channelId, accountId, provider: "x" },
      dedupeKey: jobId,
      attemptsMade: 1,
    });

    assert.strictEqual(publishCalled, false, "Provider should be skipped for idempotent job");

    const logs = await prisma.publishLog.findMany({ where: { dedupeKey: mirrorKeyOf(jobId) } });
    assert.strictEqual(logs.length, 1, "Should still have exactly 1 log entry");
  });

  it("queue round-trip: enqueue and verify queue health", async () => {
    ctx = await setupTest();

    const health = await ctx.queue.health();
    assert.ok(health.ok, `Queue not healthy: ${health.ok ? "" : health.error}`);

    const enqueueResult = await ctx.queue.enqueue({
      id: `publish-queue-${ts}`,
      payload: {
        postId: "test-post-id",
        channelId: "test-channel-id",
        provider: "x",
      },
      dedupeKey: `queue-test-${ts}`,
    });

    assert.ok(enqueueResult.ok, `Enqueue failed: ${enqueueResult.ok ? "" : enqueueResult.error}`);
  });
});
