/**
 * Publish Flow Integration Test
 *
 * Tests the critical publish path end-to-end:
 *   create post in DB → create channel → invoke PublishHandler → verify PublishLog
 *
 * Uses real PostgreSQL + Redis (via setupTest) with mock provider adapters
 * from the workers test helpers.
 *
 * @file publish.flow.test.ts
 * @description Tests for Publish Flow
 * @layer infrastructure
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { setupTest, TestContext } from "./setup.js";
import { prisma } from "@infra/prisma";
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
    getLogByDedupeKey: async (dedupeKey: string) => {
      return (await repo.getLogByDedupeKey(dedupeKey)) as Result<{ status: string } | null, string>;
    },
    getPostById: async (id: string) => {
      return (await repo.getPostById(id)) as Result<CanonicalPost, string>;
    },
    // Tenant owner lookup — the handler calls it whenever a job payload omits
    // `accountId`, so the flow repo must expose the real one.
    getChannelOwnerAccountId: async (id: string) => {
      return (await repo.getChannelOwnerAccountId(id)) as Result<string | null, string>;
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

function buildHandler(ctx: TestContext, provider: PublishProvider): PublishHandler {
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
  });
}

// ---------------------------------------------------------------------------
// Shared state — created once, cleaned up in after()
// ---------------------------------------------------------------------------

let accountId: string;
let projectId: string;
let channelId: string;
const postIds: string[] = [];
const dedupeKeys: string[] = [];

describe("Publish Flow", { concurrency: 1 }, () => {
  let ctx: TestContext;

  after(async () => {
    // Cleanup in FK-safe order: logs → posts → channels → projects → accounts
    for (const dk of dedupeKeys) {
      try {
        await prisma.publishLog.deleteMany({ where: { dedupeKey: dk } });
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

    const post = await ctx.repo.createPost({
      projectId,
      locale: "es" as const,
      body: "Hello from publish flow test!",
    });
    assert.ok(post.ok, `Create post: ${post.ok ? "" : post.error}`);
    postIds.push(post.value.id);

    const dedupeKey = `happy-${post.value.id}-${ts}`;
    dedupeKeys.push(dedupeKey);

    const handler = buildHandler(ctx, createMockProvider());

    await handler.handleJob({
      payload: { postId: post.value.id, channelId, accountId, provider: "x" },
      dedupeKey,
    });

    // Verify PublishLog
    const logs = await prisma.publishLog.findMany({
      where: { dedupeKey },
      orderBy: { createdAt: "desc" },
    });

    const okLog = logs.find((l) => l.status === "OK");
    assert.ok(okLog, "Should have an OK PublishLog entry");
    assert.strictEqual(okLog.provider, "X");
    assert.strictEqual(okLog.channelId, channelId);
  });

  it("provider failure: verify PublishLog has ERR status", async () => {
    ctx = await setupTest();

    const post = await ctx.repo.createPost({
      projectId,
      locale: "es" as const,
      body: "This post will fail to publish",
    });
    assert.ok(post.ok);
    postIds.push(post.value.id);

    const dedupeKey = `fail-${post.value.id}-${ts}`;
    dedupeKeys.push(dedupeKey);

    // Mock provider that fails on publish
    const failingProvider: PublishProvider = {
      ...createMockProvider(),
      publish: async () => ({
        ok: false as const,
        error: { code: "RATE_LIMIT", message: "Too many requests" },
      }),
    };

    const handler = buildHandler(ctx, failingProvider);

    // handleJob writes the ERR PublishLog and then re-throws so BullMQ's retry
    // policy can take effect (see publishHandler.handleJob catch block).
    await assert.rejects(
      handler.handleJob({
        payload: { postId: post.value.id, channelId, accountId, provider: "x" },
        dedupeKey,
      })
    );

    const logs = await prisma.publishLog.findMany({
      where: { dedupeKey },
      orderBy: { createdAt: "desc" },
    });

    const errLog = logs.find((l) => l.status === "ERR");
    assert.ok(errLog, "Should have an ERR PublishLog entry");
    assert.strictEqual(errLog.provider, "X");
  });

  it("idempotency: skip publish when PublishLog already has OK", async () => {
    ctx = await setupTest();

    const post = await ctx.repo.createPost({
      projectId,
      locale: "es" as const,
      body: "Already published post",
    });
    assert.ok(post.ok);
    postIds.push(post.value.id);

    const dedupeKey = `idem-${post.value.id}-${ts}`;
    dedupeKeys.push(dedupeKey);

    // Pre-insert PublishLog with OK status
    await prisma.publishLog.create({
      data: {
        postId: post.value.id,
        provider: "X",
        channelId,
        status: "OK",
        payload: { providerPostId: "already-published" },
        dedupeKey,
      },
    });

    // Track provider.publish calls
    let publishCalled = false;
    const trackingProvider: PublishProvider = {
      ...createMockProvider(),
      publish: async (input) => {
        publishCalled = true;
        return createMockProvider().publish(input);
      },
    };

    const handler = buildHandler(ctx, trackingProvider);

    await handler.handleJob({
      payload: { postId: post.value.id, channelId, accountId, provider: "x" },
      dedupeKey,
    });

    assert.strictEqual(publishCalled, false, "Provider should be skipped for idempotent job");

    const logs = await prisma.publishLog.findMany({ where: { dedupeKey } });
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
