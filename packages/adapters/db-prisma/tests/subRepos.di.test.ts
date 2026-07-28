/**
 * @file subRepos.di.test.ts
 * @description RED→GREEN DI contract tests for sub-repo client threading.
 *              Verifies that each sub-repo factory uses the INJECTED PrismaClient
 *              (passed via createPrismaRepoAdapter options.prisma), not the global
 *              singleton from @infra/prisma.
 *              Tier 0: no DB, no Redis — pure mock.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import {
  createAccountRepository,
  createProjectRepository,
  createPostRepository,
  createChannelRepository,
  createPublishLogRepository,
  createAnalyticsRepository,
  createThreadRepository,
} from "../src/index.js";

/**
 * Build a minimal PrismaClient stub with spied model accessors.
 * Every model method that the sub-repos call is tracked.
 */
function makeTrackedMockClient() {
  const accountFindUnique = vi.fn().mockResolvedValue(null);
  const accountCreate = vi.fn().mockResolvedValue({
    id: "acc-1",
    email: "e@e.com",
    name: "test",
    maxProjects: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const accountUpdate = vi.fn().mockResolvedValue({
    id: "acc-1",
    email: "e@e.com",
    name: "updated",
    maxProjects: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const accountDelete = vi.fn().mockResolvedValue({ id: "acc-1" });
  const accountFindMany = vi.fn().mockResolvedValue([]);

  const projectCreate = vi.fn().mockResolvedValue({ id: "proj-1", name: "p", accountId: "acc-1" });
  const projectFindMany = vi.fn().mockResolvedValue([]);
  const projectDelete = vi.fn().mockResolvedValue({ id: "proj-1" });

  const postFindUnique = vi.fn().mockResolvedValue(null);
  const postCount = vi.fn().mockResolvedValue(0);
  const postFindMany = vi.fn().mockResolvedValue([]);
  const postMediaCreate = vi.fn().mockResolvedValue({ id: "m-1" });

  const channelFindMany = vi.fn().mockResolvedValue([]);
  const channelFindUnique = vi.fn().mockResolvedValue(null);
  const transactionExecuteRaw = vi.fn().mockResolvedValue(1);

  // Every repo that runs inside `$transaction` sees the SAME fake transaction
  // client, so the tracked spies keep working through the transactional path.
  // `$executeRaw` is what `setTenantGuc` binds the RLS GUC with, and
  // `channel.findMany` routes back to the tracked `channelFindMany` spy so the
  // "uses INJECTED client" assertion still observes the real call.
  const runTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const fakeTx = {
      $executeRaw: transactionExecuteRaw,
      post: {
        create: vi.fn().mockResolvedValue({ id: "post-1", projectId: "proj-1", scheduledAt: null }),
      },
      postContent: {
        create: vi
          .fn()
          .mockResolvedValue({ locale: "en", title: null, summary: null, body: "hi", tags: [] }),
      },
      postMedia: {
        create: vi.fn().mockResolvedValue({
          id: "m-1",
          type: "IMAGE",
          url: "u",
          width: null,
          height: null,
          durationMs: null,
          alt: null,
        }),
      },
      channel: { findMany: channelFindMany, findUnique: channelFindUnique },
    };
    return fn(fakeTx);
  });

  const publishLogUpsert = vi.fn().mockResolvedValue({
    id: "pl-1",
    postId: "post-1",
    provider: "TWITTER",
    channelId: "ch-1",
    status: "QUEUED",
    payload: {},
    dedupeKey: "dk-1",
    createdAt: new Date(),
  });
  const publishLogFindUnique = vi.fn().mockResolvedValue(null);
  const publishLogFindMany = vi.fn().mockResolvedValue([]);

  const analyticsFindMany = vi.fn().mockResolvedValue([]);
  const analyticsCreate = vi.fn().mockResolvedValue({
    id: "an-1",
    postId: null,
    channelId: "ch-1",
    provider: "TWITTER",
    views: null,
    likes: null,
    comments: null,
    shares: null,
    capturedAt: new Date(),
  });

  const threadFindUnique = vi.fn().mockResolvedValue(null);
  const threadCreate = vi.fn().mockResolvedValue({
    id: "thr-1",
    postId: "post-1",
    strategy: "THREAD",
    tweets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const threadDelete = vi.fn().mockResolvedValue({ id: "thr-1" });
  const tweetFindUnique = vi.fn().mockResolvedValue(null);
  const tweetCreate = vi.fn().mockResolvedValue({
    id: "tw-1",
    threadId: "thr-1",
    sequenceNumber: 1,
    content: "hi",
    media: null,
    tweetId: null,
    parentTweetId: null,
    status: "PENDING",
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const tweetUpdate = vi.fn().mockResolvedValue({
    id: "tw-1",
    threadId: "thr-1",
    sequenceNumber: 1,
    content: "hi",
    media: null,
    tweetId: null,
    parentTweetId: null,
    status: "PUBLISHED",
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const tweetFindMany = vi.fn().mockResolvedValue([]);

  const client = {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $transaction: runTransaction,
    account: {
      findUnique: accountFindUnique,
      create: accountCreate,
      update: accountUpdate,
      delete: accountDelete,
      findMany: accountFindMany,
    },
    project: {
      create: projectCreate,
      findMany: projectFindMany,
      delete: projectDelete,
    },
    post: {
      findUnique: postFindUnique,
      count: postCount,
      findMany: postFindMany,
    },
    postMedia: { create: postMediaCreate },
    channel: { findMany: channelFindMany, findUnique: channelFindUnique },
    publishLog: {
      upsert: publishLogUpsert,
      findUnique: publishLogFindUnique,
      findMany: publishLogFindMany,
    },
    analytics: {
      findMany: analyticsFindMany,
      create: analyticsCreate,
    },
    thread: {
      findUnique: threadFindUnique,
      create: threadCreate,
      delete: threadDelete,
    },
    tweet: {
      findUnique: tweetFindUnique,
      create: tweetCreate,
      update: tweetUpdate,
      findMany: tweetFindMany,
    },
  } as unknown as PrismaClient;

  return {
    client,
    spies: {
      accountFindUnique,
      accountCreate,
      accountUpdate,
      accountDelete,
      accountFindMany,
      projectCreate,
      projectFindMany,
      projectDelete,
      postFindUnique,
      postCount,
      postFindMany,
      runTransaction,
      transactionExecuteRaw,
      channelFindMany,
      channelFindUnique,
      publishLogUpsert,
      publishLogFindUnique,
      publishLogFindMany,
      analyticsFindMany,
      analyticsCreate,
      threadFindUnique,
      threadCreate,
      threadDelete,
      tweetFindUnique,
      tweetCreate,
      tweetUpdate,
      tweetFindMany,
    },
  };
}

const mockReadBreaker = { fire: vi.fn((fn: () => Promise<unknown>) => fn()) };
const mockWriteBreaker = { fire: vi.fn((fn: () => Promise<unknown>) => fn()) };
const mockTransactionBreaker = { fire: vi.fn((fn: () => Promise<unknown>) => fn()) };

describe("sub-repo DI contract — injected client threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AccountRepository", () => {
    it("createAccount — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      spies.accountCreate.mockResolvedValueOnce({
        id: "acc-1",
        email: "a@a.com",
        name: "Alice",
        maxProjects: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = createAccountRepository(mockReadBreaker, mockWriteBreaker, client);
      const result = await repo.createAccount({ email: "a@a.com", name: "Alice" });

      assert.ok(result.ok, "createAccount should succeed");
      expect(spies.accountCreate).toHaveBeenCalledTimes(1);
    });

    it("getAccountById — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      spies.accountFindUnique.mockResolvedValueOnce({
        id: "acc-1",
        email: "a@a.com",
        name: "Alice",
        maxProjects: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = createAccountRepository(mockReadBreaker, mockWriteBreaker, client);
      const result = await repo.getAccountById("acc-1");

      assert.ok(result.ok, "getAccountById should succeed");
      expect(spies.accountFindUnique).toHaveBeenCalledTimes(1);
    });

    it("listAccounts — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createAccountRepository(mockReadBreaker, mockWriteBreaker, client);
      await repo.listAccounts();
      expect(spies.accountFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("ProjectRepository", () => {
    it("getProjectsByAccount — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createProjectRepository(client);
      await repo.getProjectsByAccount("acc-1");
      expect(spies.projectFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("PostRepository", () => {
    it("getPostById — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createPostRepository(mockTransactionBreaker, client);
      await repo.getPostById("post-1");
      expect(spies.postFindUnique).toHaveBeenCalledTimes(1);
    });

    it("listPosts — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createPostRepository(mockTransactionBreaker, client);
      await repo.listPosts({ limit: 10, offset: 0 });
      expect(spies.postCount).toHaveBeenCalledTimes(1);
      expect(spies.postFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("ChannelRepository", () => {
    it("getChannelsByIds — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createChannelRepository({}, client);

      const result = await repo.getChannelsByIds(["ch-1"], "acc-1");

      assert.ok(result.ok, "getChannelsByIds should succeed");
      expect(spies.runTransaction).toHaveBeenCalledTimes(1);
      expect(spies.transactionExecuteRaw).toHaveBeenCalledTimes(1);
      expect(spies.channelFindMany).toHaveBeenCalledTimes(1);
      // The lookup MUST carry the caller's tenant predicate — this is the
      // worker-side isolation layer, so the DI test locks it too.
      expect(spies.channelFindMany).toHaveBeenCalledWith({
        where: { id: { in: ["ch-1"] }, accountId: "acc-1" },
      });
    });

    it("getChannelOwnerAccountId — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      spies.channelFindUnique.mockResolvedValueOnce({ accountId: "acc-1" });
      const repo = createChannelRepository({}, client);

      const result = await repo.getChannelOwnerAccountId("ch-1");

      assert.ok(result.ok, "getChannelOwnerAccountId should succeed");
      assert.strictEqual(result.value, "acc-1");
      expect(spies.channelFindUnique).toHaveBeenCalledTimes(1);
      expect(spies.transactionExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it("getChannelsByIds — rejects a blank tenant scope without querying", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createChannelRepository({}, client);

      // Prisma DROPS an `undefined` from a `where`, so an unvalidated
      // `accountId` would widen the query to EVERY tenant and decrypt them.
      // BullMQ payloads are unvalidated JSON, so the guard must be at runtime.
      const blank = await repo.getChannelsByIds(["ch-1"], "");
      const missing = await repo.getChannelsByIds(["ch-1"], undefined as unknown as string);

      assert.ok(!blank.ok, "an empty accountId must not reach the database");
      assert.strictEqual(blank.error, "DATABASE_ERROR");
      assert.ok(!missing.ok, "a missing accountId must not reach the database");
      assert.strictEqual(missing.error, "DATABASE_ERROR");
      expect(spies.channelFindMany).not.toHaveBeenCalled();
      expect(spies.runTransaction).not.toHaveBeenCalled();
    });

    it("getChannelOwnerAccountId — resolves no owner for a blank channelId without querying", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createChannelRepository({}, client);

      const result = await repo.getChannelOwnerAccountId("");

      assert.ok(result.ok, "a malformed job id is a terminal no-owner outcome, not a DB fault");
      assert.strictEqual(result.value, null);
      expect(spies.channelFindUnique).not.toHaveBeenCalled();
      expect(spies.runTransaction).not.toHaveBeenCalled();
    });
  });

  describe("PublishLogRepository", () => {
    it("logPublish — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createPublishLogRepository(client);
      await repo.logPublish({
        postId: "post-1",
        provider: "x",
        channelId: "ch-1",
        status: "QUEUED",
        payload: {},
        dedupeKey: "dk-1",
      });
      expect(spies.publishLogUpsert).toHaveBeenCalledTimes(1);
    });

    it("getLogByDedupeKey — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createPublishLogRepository(client);
      await repo.getLogByDedupeKey("dk-1");
      expect(spies.publishLogFindUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("AnalyticsRepository", () => {
    it("listAnalytics — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createAnalyticsRepository(client);
      await repo.listAnalytics({});
      expect(spies.analyticsFindMany).toHaveBeenCalledTimes(1);
    });

    it("addAnalytics — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createAnalyticsRepository(client);
      await repo.addAnalytics({ channelId: "ch-1", provider: "x" });
      expect(spies.analyticsCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("ThreadRepository", () => {
    it("getThreadByPostId — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createThreadRepository(client);
      await repo.getThreadByPostId("post-1");
      expect(spies.threadFindUnique).toHaveBeenCalledTimes(1);
    });

    it("getTweetsByThread — uses INJECTED client, not global", async () => {
      const { client, spies } = makeTrackedMockClient();
      const repo = createThreadRepository(client);
      await repo.getTweetsByThread("thr-1");
      expect(spies.tweetFindMany).toHaveBeenCalledTimes(1);
    });
  });
});
