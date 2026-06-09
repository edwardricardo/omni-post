/**
 * @file setup.ts
 * @description Test setup for setup
 * @layer infrastructure
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { prisma } from "@infra/prisma";
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import { createRedisConnection } from "../src/lib/redis.js";

// Load test environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

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
 * Initialize test environment with proper connection management
 */
export async function setupTest(): Promise<TestContext> {
  try {
    // Create adapters if they don't exist
    if (!globalRepo) {
      console.log("Creating Prisma repo adapter...");
      globalRepo = createPrismaRepoAdapter({ prisma });
      if (!globalRepo) {
        throw new Error("Failed to create Prisma repo adapter - returned null");
      }
      console.log("✓ Prisma repo adapter created");
    }

    if (!globalQueue) {
      console.log("Creating BullMQ queue adapter...");
      // The adapter no longer self-constructs a connection (composition-root-
      // owned in production); the test owns and injects the socket.
      globalQueue = createBullMQQueueAdapter({
        queueName: "publish",
        connection: createRedisConnection(),
      });
      if (!globalQueue) {
        throw new Error("Failed to create BullMQ queue adapter - returned null");
      }
      console.log("✓ BullMQ queue adapter created");
    }

    // Verify repo has required methods
    if (!globalRepo.createAccount) {
      throw new Error("Repo adapter missing createAccount method");
    }

    // Test connections with timeout
    console.log("Testing connections...");
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

    console.log("✓ Test setup completed - DB/Redis connections verified");

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

    console.log("✓ Context validated with repo and queue");
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
 * Cleanup test environment - final cleanup only
 */
export async function teardownTest(): Promise<void> {
  try {
    // Only do light cleanup between tests - don't reset global variables
    console.log("✓ Test cleanup completed");
  } catch (error) {
    console.warn("Test cleanup warning:", error);
  }
}

/**
 * Final cleanup - only call this at the end of the entire test suite
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

    // Wait for cleanup with timeout
    await Promise.race([
      Promise.all(cleanupPromises),
      new Promise((resolve) => {
        const t = setTimeout(resolve, 2000);
        t.unref();
      }), // 2s cleanup timeout
    ]);

    globalRepo = null;
    globalQueue = null;

    console.log("✓ Final cleanup completed");
  } catch (error) {
    console.warn("Final cleanup warning:", error);
  }
}

/**
 * Run test with automatic setup/teardown and timeout protection
 */
export async function runTestWithSetup<T>(
  testName: string,
  testFn: (ctx: TestContext) => Promise<T>,
  timeoutMs: number = TEST_CONFIG.timeout
): Promise<T> {
  console.log(`🧪 Running test: ${testName}`);

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

    console.log(`✓ Running test ${testName} with valid context`);

    // Run test with timeout
    const result = await Promise.race([
      testFn(ctx),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error(`Test timeout for ${testName}`)), timeoutMs);
        t.unref();
      }),
    ]);

    console.log(`✓ ${testName} passed`);
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
 * Returns an afterEach callback that cleans up posts, projects, and accounts
 * created during a flow test, then calls teardownTest().
 *
 * Usage:
 * ```ts
 * afterEach(makeFlowCleanup(
 *   () => ctx,
 *   createdPosts, createdProjects, createdAccounts,
 * ));
 * ```
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
 * Sleep utility for tests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

/**
 * Test timeout wrapper
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
