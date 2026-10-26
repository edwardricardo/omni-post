/**
 * @file setup.ts
 * @description Shared setup of the `*.flow.integration.test.ts` suites, which run under node:test:
 *   one repository adapter and one `publish` queue adapter per process, a separate repository
 *   adapter for a test that fails on purpose, per-test and final teardown, and timeout helpers.
 *   Its progress lines go to stderr, never stdout (DEF-83).
 * @layer infrastructure
 */
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import { createRedisConnection } from "../src/lib/redis.js";
import { createSeedPrismaClient } from "./integration/helpers/seedPrismaClient.js";
import { findMonorepoRoot } from "@packages/vitest-shared";

/**
 * Fixture AND subject channel for the shared publish-flow setup: it plants the account,
 * project and channel a suite starts from, and it is also the client behind the repository
 * adapter the flow then drives. The flow suites prove the publish path's behaviour, not the
 * role it runs as; the role is proved on the application channel by the
 * `integration:tenant-isolation` batch, `publishWorkerTenantIsolation.integration.test.ts` included.
 */
const prisma = createSeedPrismaClient();

// Load the root .env.test when it exists (the integration tier exports it first; this is the fallback).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(findMonorepoRoot(__dirname), ".env.test");
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Every progress line below goes to stderr on purpose: in a node:test child, stdout
// is the runner's message channel, and a non-ASCII line written right after a frame is misread
// as the next frame's length, failing a file whose tests passed (DEF-83).

// Test configuration
export const TEST_CONFIG = {
  timeout: parseInt(process.env.TEST_TIMEOUT || "10000"),
  dbTimeout: parseInt(process.env.DB_TIMEOUT || "5000"),
  redisTimeout: parseInt(process.env.REDIS_TIMEOUT || "3000"),
  queueTimeout: parseInt(process.env.QUEUE_TIMEOUT || "5000"),
};

// Global test instances
let globalRepo: ReturnType<typeof createPrismaRepoAdapter> | null = null;
let globalQueue: ReturnType<typeof createBullMQQueueAdapter> | null = null;

export interface TestContext {
  repo: ReturnType<typeof createPrismaRepoAdapter>;
  queue: ReturnType<typeof createBullMQQueueAdapter>;
}

/**
 * Ensure test account and project exist
 */
async function _ensureTestData(repo: ReturnType<typeof createPrismaRepoAdapter>): Promise<void> {
  try {
    // Try to get existing account by email
    const existingAccount = await repo.getAccountByEmail("test@example.com");

    let accountId: string;
    if (existingAccount.ok) {
      accountId = existingAccount.value.id;
    } else {
      // Create test account
      const accountResult = await repo.createAccount({
        email: "test@example.com",
        name: "Test Account",
        subscription: "PRO",
      });

      if (!accountResult.ok) {
        console.warn("Failed to create test account:", accountResult.error);
        return;
      }
      accountId = accountResult.value.id;
    }

    // Try to get projects for the account
    const projectsResult = await repo.getProjectsByAccount(accountId);
    if (projectsResult.ok && projectsResult.value.some((p) => p.name === "dev")) {
      // Test project already exists
      return;
    }

    // Create test project with fixed ID 'dev'
    const createProjectResult = await repo.createProject({
      accountId,
      name: "dev",
      locale: "es",
    });

    if (!createProjectResult.ok) {
      console.warn("Failed to create test project:", createProjectResult.error);
    }
  } catch (error) {
    console.warn("Test data setup failed:", error);
  }
}

/**
 * @description Returns the adapters the flow suites share, creating them on the first call of the
 *   process: a Prisma repository adapter over the seed client, and a BullMQ adapter for the
 *   `publish` queue on a Redis connection created here. Every call then waits, for at most
 *   `TEST_CONFIG.dbTimeout`, on the queue's `health()` and a one-row `listLogs` read. Both return
 *   a `Result` that is not inspected, so only a rejection or the timeout fails the setup. On a
 *   failure both adapters are dropped without being closed, so the next call creates new ones,
 *   and the error is rethrown.
 * @returns The shared repository and queue adapters.
 */
export async function setupTest(): Promise<TestContext> {
  try {
    // Create adapters if they don't exist
    if (!globalRepo) {
      console.error("Creating Prisma repo adapter...");
      globalRepo = createPrismaRepoAdapter({ prisma });
      if (!globalRepo) {
        throw new Error("Failed to create Prisma repo adapter - returned null");
      }
      console.error("✓ Prisma repo adapter created");
    }

    if (!globalQueue) {
      console.error("Creating BullMQ queue adapter...");
      // The adapter no longer self-constructs a connection (composition-root-
      // owned in production); the test owns and injects the socket.
      globalQueue = createBullMQQueueAdapter({
        queueName: "publish",
        connection: createRedisConnection(),
      });
      if (!globalQueue) {
        throw new Error("Failed to create BullMQ queue adapter - returned null");
      }
      console.error("✓ BullMQ queue adapter created");
    }

    // Verify repo has required methods
    if (!globalRepo.createAccount) {
      throw new Error("Repo adapter missing createAccount method");
    }

    // Test connections with timeout
    console.error("Testing connections...");
    const healthCheckPromise = Promise.all([
      globalQueue.health(),
      // Simple repo test without complex operations
      globalRepo.listLogs({ limit: 1 }),
    ]);

    const _healthResults = await Promise.race([
      healthCheckPromise,
      new Promise((_, reject) =>
        (() => {
          const t = setTimeout(
            () => reject(new Error("Health check timeout")),
            TEST_CONFIG.dbTimeout
          );
          t.unref();
          return t;
        })()
      ),
    ]);

    console.error("✓ Test setup completed - DB/Redis connections verified");

    const context = {
      repo: globalRepo,
      queue: globalQueue,
    };

    // Verify context is valid before returning
    if (!context.repo) {
      throw new Error("Context repo is null after setup");
    }
    if (!context.repo.createAccount) {
      throw new Error("Context repo missing createAccount method");
    }

    console.error("✓ Context validated with repo and queue");
    return context;
  } catch (error) {
    console.error("✗ Test setup failed:", error);
    // Reset global adapters on failure
    globalRepo = null;
    globalQueue = null;
    throw error;
  }
}

/**
 * @description Creates a repository adapter of its own over the seed client, for a test that
 *   makes the adapter fail on purpose. Each adapter owns its circuit breakers, and the database
 *   breaker counts every rejected operation, a refused domain write included, so a deliberate
 *   failure on the shared adapter would open its breaker and fail the calls of every test that
 *   runs after it in the same process. The shared adapters of `setupTest` are not touched. Never
 *   call `close()` on the returned adapter: it disconnects the seed client the shared adapter
 *   also runs on, which `finalCleanup` owns.
 * @returns A new repository adapter, never the shared one.
 */
export function createIsolatedRepo(): ReturnType<typeof createPrismaRepoAdapter> {
  return createPrismaRepoAdapter({ prisma });
}

/**
 * @description Per-test teardown, which releases nothing: the shared adapters stay open for the
 *   next test, and the call only logs to stderr. `finalCleanup` is the one that closes them.
 */
export async function teardownTest(): Promise<void> {
  try {
    // Only do light cleanup between tests - don't reset global variables
    console.error("✓ Test cleanup completed");
  } catch (error) {
    console.warn("Test cleanup warning:", error);
  }
}

/**
 * @description Closes the shared adapters; call it once, at the end of the whole suite. It calls
 *   `close()` on the queue adapter and on the repository adapter when they exist, waits for both
 *   to settle, for at most 2 s, and then drops them, so a later `setupTest` creates new ones. A
 *   failed close, and a close still pending after 2 s, is logged as a warning and never thrown.
 */
export async function finalCleanup(): Promise<void> {
  try {
    const cleanupPromises: Promise<any>[] = [];

    // Cleanup queue connections (if queue has close method)
    if (globalQueue && typeof globalQueue.close === "function") {
      cleanupPromises.push(
        globalQueue.close().catch((err) => {
          console.warn("Queue cleanup warning:", err.message);
        })
      );
    }

    // Cleanup database connections (if repo has close method)
    if (globalRepo && typeof globalRepo.close === "function") {
      cleanupPromises.push(
        globalRepo.close().catch((err) => {
          console.warn("Repo cleanup warning:", err.message);
        })
      );
    }

    // The 2 s bound rejects instead of resolving, so a close still pending is reported as such
    // rather than taken for a finished one.
    await withTimeout(
      Promise.all(cleanupPromises),
      2000,
      "Final cleanup: a close was still pending after 2 s"
    );

    console.error("✓ Final cleanup completed");
  } catch (error) {
    console.warn("Final cleanup warning:", error);
  } finally {
    globalRepo = null;
    globalQueue = null;
  }
}

/**
 * @description Runs one test against the shared adapters: `setupTest` within half of
 *   `timeoutMs`, then `testFn` within all of it, logging each step to stderr, and `teardownTest`
 *   afterwards whatever the outcome; a teardown failure is logged as a warning, never thrown.
 * @param testName - Names the test in the progress lines and in the timeout errors.
 * @param testFn - The test body, called with the shared context.
 * @param timeoutMs - The time limit of the test body, in milliseconds; the setup gets half of it.
 *   Defaults to `TEST_CONFIG.timeout`.
 * @returns What `testFn` resolves to. Rejects with the setup or test timeout, or with the error
 *   `setupTest` or `testFn` raised.
 */
export async function runTestWithSetup<T>(
  testName: string,
  testFn: (ctx: TestContext) => Promise<T>,
  timeoutMs: number = TEST_CONFIG.timeout
): Promise<T> {
  console.error(`🧪 Running test: ${testName}`);

  let ctx: TestContext | null = null;

  try {
    // Setup with timeout
    ctx = await Promise.race([
      setupTest(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error(`Setup timeout for ${testName}`)),
          timeoutMs / 2
        );
        t.unref();
      }),
    ]);

    // Verify context before running test
    if (!ctx) {
      throw new Error(`Context is null for test ${testName}`);
    }
    if (!ctx.repo) {
      throw new Error(`Context.repo is null for test ${testName}`);
    }

    console.error(`✓ Running test ${testName} with valid context`);

    // Run test with timeout
    const result = await Promise.race([
      testFn(ctx),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error(`Test timeout for ${testName}`)), timeoutMs);
        t.unref();
      }),
    ]);

    console.error(`✓ ${testName} passed`);
    return result;
  } catch (error) {
    console.error(`✗ ${testName} failed:`, error);
    throw error;
  } finally {
    // Always attempt cleanup, but don't fail tests on cleanup errors
    try {
      await teardownTest();
    } catch (cleanupError) {
      console.warn(`Cleanup warning for ${testName}:`, cleanupError);
    }
  }
}

/**
 * @description Builds the `afterEach` callback of a flow suite. When `getCtx` returns a context,
 *   the callback deletes every recorded post, then every project, then every account through the
 *   repository adapter, ignoring a deletion that throws or returns an error, empties the three
 *   lists, and calls `teardownTest`. With no context it does nothing and leaves the lists as
 *   they are.
 *
 * Usage:
 * ```ts
 * afterEach(makeFlowCleanup(
 *   () => ctx,
 *   createdPosts, createdProjects, createdAccounts,
 * ));
 * ```
 * @param getCtx - Reads the suite's current context; `undefined` before its setup ran.
 * @param createdPosts - Ids of the posts the test created; the callback empties it.
 * @param createdProjects - Ids of the projects the test created; the callback empties it.
 * @param createdAccounts - Ids of the accounts the test created; the callback empties it.
 * @returns The callback to pass to `afterEach`.
 */
export function makeFlowCleanup(
  getCtx: () => TestContext | undefined,
  createdPosts: string[],
  createdProjects: string[],
  createdAccounts: string[]
): () => Promise<void> {
  return async () => {
    const ctx = getCtx();

    if (ctx) {
      for (const postId of createdPosts) {
        try {
          await ctx.repo.deletePost(postId);
        } catch {
          // Ignore cleanup errors
        }
      }
      createdPosts.length = 0;

      for (const projectId of createdProjects) {
        try {
          await ctx.repo.deleteProject(projectId);
        } catch {
          // Ignore cleanup errors
        }
      }
      createdProjects.length = 0;

      for (const accountId of createdAccounts) {
        try {
          await ctx.repo.deleteAccount(accountId);
        } catch {
          // Ignore cleanup errors
        }
      }
      createdAccounts.length = 0;

      await teardownTest();
    }
  };
}

/**
 * @description Races `promise` against a timer. The timer is unref'd and never cleared, and
 *   `promise` is not cancelled when the time runs out: it keeps running, unobserved.
 * @param promise - The work to wait for.
 * @param timeoutMs - How long to wait, in milliseconds.
 * @param errorMessage - The message of the error the timeout rejects with. Defaults to
 *   "Operation timeout".
 * @returns A promise that settles as `promise` does, or rejects with `errorMessage` once
 *   `timeoutMs` has passed.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = "Operation timeout"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      (() => {
        const t = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        t.unref();
        return t;
      })()
    ),
  ]);
}
