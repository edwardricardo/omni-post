/**
 * Shared test helpers for SyncEngine test suites.
 *
 * Provides shared Prisma + Redis connections, mock EventService, and
 * setup/teardown utilities so every test file can initialize its own
 * isolated SyncEngine instance without duplicating infrastructure code.
 *
 * @file syncEngine.helpers.ts
 * @description Test helpers for sync engine helpers
 * @layer infrastructure
 */

import { createTestPrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import { ContentSynchronizer } from "../../../src/orchestration/ContentSynchronizer";
import { ContentVersionManager } from "../../../src/content/ContentVersionManager";
import { SyncScheduler } from "../../../src/content/SyncScheduler";
import { SyncEngine } from "../../../src/content/SyncEngine";

// ---------------------------------------------------------------------------
// Prevent blocking xreadgroup BLOCK 1000 loop during tests.
// Tests validate sync logic (channels, transactions, conflicts, metrics),
// not the Redis stream processor loop which blocks 1s per iteration.
// ---------------------------------------------------------------------------
SyncScheduler.prototype.startRealtimeProcessors = function () {
  // no-op: avoids setImmediate + xreadgroup blocking loop
};

// Patch SyncEngine's own startRealtimeProcessors (private, but accessible on
// the prototype). SyncEngine does NOT delegate to SyncScheduler, so it needs
// its own patch to prevent the infinite setImmediate + xreadgroup loop.
(SyncEngine.prototype as any).startRealtimeProcessors = function () {
  // no-op: avoids setImmediate + xreadgroup blocking loop in tests
};

// ---------------------------------------------------------------------------
// Shared infrastructure (one connection pool for all test files)
// ---------------------------------------------------------------------------

export const mockPrisma = createTestPrismaClient();

export const mockRedis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy: () => null, // Don't reconnect after disconnect — prevents hanging process
});

// Mock EventService to avoid RedisEventPublisher timer/connection leaks
export const mockEventService = {
  publishEvent: async () => ({ ok: true, value: undefined }),
  registerHandler: () => {},
  shutdown: async () => {},
} as any;

// ---------------------------------------------------------------------------
// State shared across test files (mutated by setup / teardown)
// ---------------------------------------------------------------------------

export let synchronizer: ContentSynchronizer;
export let versionManager: ContentVersionManager;
export let servicesAvailable = false;

export let testAccountId: string;
export let testProjectId: string;
export let testPostId: string;

// ---------------------------------------------------------------------------
// Setup / teardown helpers
// ---------------------------------------------------------------------------

/**
 * Connect to Redis and PostgreSQL, seed test data.
 * Call from `before()` in each test file.
 *
 * Returns `true` when services are available, `false` otherwise.
 */
export async function setupSyncEngineInfra(): Promise<boolean> {
  // Connect to Redis
  try {
    await mockRedis.connect();
  } catch {
    return false;
  }

  // Check Prisma connectivity
  try {
    await mockPrisma.$connect();
  } catch {
    return false;
  }

  servicesAvailable = true;

  // Initialize shared dependencies (using mockEventService to avoid timer leaks)
  synchronizer = new ContentSynchronizer({
    prisma: mockPrisma,
    redis: mockRedis,
    eventService: mockEventService,
  });

  versionManager = new ContentVersionManager({
    prisma: mockPrisma,
    redis: mockRedis,
    eventService: mockEventService,
  });

  // Seed test account
  const account = await mockPrisma.account.create({
    data: {
      name: "SyncEngine Test Account",
      email: `syncengine-${Date.now()}@test.com`,
    },
  });
  testAccountId = account.id;

  // Seed test project
  const project = await mockPrisma.project.create({
    data: {
      name: "SyncEngine Test Project",
      accountId: testAccountId,
    },
  });
  testProjectId = project.id;

  // Seed test post
  const post = await mockPrisma.post.create({
    data: {
      projectId: testProjectId,
      status: "DRAFT",
    },
  });
  testPostId = post.id;

  // Seed post content
  await mockPrisma.postContent.create({
    data: {
      postId: testPostId,
      body: "Test sync content",
      locale: "en",
    },
  });

  return true;
}

/**
 * Remove seeded test data and close all connections.
 * Call from `after()` in each test file — only the LAST file should call this.
 *
 * Because node:test runs each file in its own process (when using
 * --test-concurrency > 1), every file gets its own module instance, so
 * each file independently owns the seeded rows and must clean them up.
 */
export async function teardownSyncEngineInfra(currentSyncEngine?: any): Promise<void> {
  // Shutdown active SyncEngine to clear SyncScheduler intervals
  if (currentSyncEngine) {
    try {
      await currentSyncEngine.shutdown();
    } catch {
      /* ignore */
    }
  }

  if (servicesAvailable) {
    try {
      await mockPrisma.postContent.deleteMany({ where: { postId: testPostId } });
      await mockPrisma.post.deleteMany({ where: { id: testPostId } });
      await mockPrisma.project.deleteMany({ where: { id: testProjectId } });
      await mockPrisma.account.deleteMany({ where: { id: testAccountId } });
    } catch {
      /* ignore cleanup errors */
    }
  }

  await mockPrisma.$disconnect();
  mockRedis.disconnect();

  // Prisma's $disconnect() is async but its internal pool sockets may need
  // an extra event-loop tick to fully close. Force-unref remaining handles
  // so the process can exit cleanly without --test-force-exit.
  const handles = (process as any)._getActiveHandles?.() ?? [];
  for (const h of handles) {
    if (typeof h.unref === "function") h.unref();
  }
}

/**
 * Clear Redis sync:* keys and optionally shut down a previous engine.
 * Call from `beforeEach()` in each test file.
 */
export async function resetSyncEngineState(previousEngine?: any): Promise<void> {
  if (!servicesAvailable) return;

  // Shutdown previous engine to clear SyncScheduler intervals
  if (previousEngine) {
    try {
      await previousEngine.shutdown();
    } catch {
      /* ignore */
    }
  }

  // Clear Redis sync keys
  const keys = await mockRedis.keys("sync:*");
  if (keys.length > 0) {
    await mockRedis.del(...keys);
  }
}

// ---------------------------------------------------------------------------
// Test utility helpers
// ---------------------------------------------------------------------------

/** Skip a test when PostgreSQL/Redis are unavailable. Returns true if skipped. */
export const skipIfUnavailable = (t: any): boolean => {
  if (!servicesAvailable) {
    t.skip("PostgreSQL/Redis not available");
    return true;
  }
  return false;
};
