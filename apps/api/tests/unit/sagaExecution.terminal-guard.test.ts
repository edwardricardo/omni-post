/**
 * @file sagaExecution.terminal-guard.test.ts
 * @description Two compliance invariants for the saga manager:
 *   - dedupeKey must be deterministic (no `randomUUID`).
 *   - `executeSaga` must reject sagas already in a terminal state.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { mintPublishJobId } from "@shared/types";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  TEST_ACCOUNT_ID,
  createMockRedis,
  createMockEventService,
  createSimpleSagaDefinition,
  SuccessfulStep,
  FailingStep,
} from "./sagaManager.test-helpers.js";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";

const scheduler = new NoopBackgroundTaskScheduler();

/**
 * Extended mock Prisma that includes sagaInstance model methods
 * needed by persistSagaInstance, loadActiveSagas, and loadSagaInstance.
 */
function createMockPrismaWithSagaInstance() {
  const store = new Map<string, Record<string, unknown>>();

  type Tx = ReturnType<typeof build>;
  function build() {
    const tx = {
      $queryRaw: async () => [{ result: 1 }],
      $executeRaw: async () => 1,
      $transaction: async <T>(fn: (innerTx: Tx) => Promise<T>) => fn(tx),
      sagaInstance: {
        upsert: async (args: {
          where: { id: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = store.get(args.where.id);
          if (existing) {
            const updated = { ...existing, ...args.update };
            store.set(args.where.id, updated);
            return updated;
          }
          store.set(args.where.id, args.create);
          return args.create;
        },
        findMany: async () => {
          return Array.from(store.values());
        },
        findUnique: async (args: { where: { id: string } }) => {
          return store.get(args.where.id) ?? null;
        },
      },
    };
    return tx;
  }
  return build();
}

describe("V5: Terminal State Guard", () => {
  let manager: SagaManagerImpl;

  beforeEach(async () => {
    const mockPrisma = createMockPrismaWithSagaInstance();
    const mockRedis = createMockRedis();
    const mockEventService = createMockEventService();

    manager = new SagaManagerImpl({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
      scheduler,
      enableMetrics: true,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it("should complete a normal saga and reach COMPLETED status", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const saga = await manager.getSaga(instance.id);
    expect(saga).toBeTruthy();
    expect(saga.status).toBe("COMPLETED");
  });

  it("should not re-execute a COMPLETED saga when continueSaga is called", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const sagaBefore = await manager.getSaga(instance.id);
    expect(sagaBefore).toBeTruthy();
    expect(sagaBefore.status).toBe("COMPLETED");

    // continueSaga should reject terminal state
    await expect(manager.continueSaga(instance.id)).rejects.toThrow(
      /COMPLETED|terminal|cannot|not in/
    );

    // Status should still be COMPLETED (unchanged)
    const sagaAfter = await manager.getSaga(instance.id);
    expect(sagaAfter).toBeTruthy();
    expect(sagaAfter.status).toBe("COMPLETED");
  });

  it("should not re-execute a FAILED saga via continueSaga", async () => {
    const failDef = {
      id: "fail-guard-test",
      name: "Fail Guard Test",
      version: "1.0.0",
      steps: [new SuccessfulStep(), new FailingStep()],
    };
    manager.registerSaga(failDef);

    const instance = await manager.startSaga(failDef.id, { accountId: TEST_ACCOUNT_ID });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const sagaAfterFail = await manager.getSaga(instance.id);
    expect(sagaAfterFail).toBeTruthy();
    expect(sagaAfterFail.status).toBe("FAILED");

    // Try to continue it — should be rejected by lifecycle guard
    await expect(manager.continueSaga(instance.id)).rejects.toThrow();

    // Status should remain FAILED
    const sagaStill = await manager.getSaga(instance.id);
    expect(sagaStill).toBeTruthy();
    expect(sagaStill.status).toBe("FAILED");
  });

  it("should allow PENDING saga to start execution normally", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    // startSaga creates a PENDING saga and then executes it
    const instance = await manager.startSaga(definition.id, { accountId: TEST_ACCOUNT_ID });
    expect(instance).toBeTruthy();

    // Wait for async execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    const saga = await manager.getSaga(instance.id);
    expect(saga).toBeTruthy();
    // Should have progressed past PENDING to COMPLETED
    expect(saga.status).toBe("COMPLETED");
  });
});

describe("V4: Deterministic dedupeKey", () => {
  it("reads no clock and no randomness anywhere in the module that mints the key", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // The producer no longer holds the format: it calls the minter, and the minter's
    // module is the only place a nondeterministic source could enter the id. Both are
    // read — the module for what it does, the producer for whether it still goes
    // through it — because a producer that drifted back to its own template would pass
    // a scan of the module alone.
    const jobIdSource = await fs.readFile(
      path.join(process.cwd(), "..", "..", "packages", "shared", "src", "publishJobId.ts"),
      "utf-8"
    );
    expect(jobIdSource).not.toMatch(/randomUUID|Math\.random|Date\.now|new Date\(/);

    const producer = await fs.readFile(
      path.join(process.cwd(), "src", "saga", "SagaIntegration.ts"),
      "utf-8"
    );
    expect(producer).toMatch(/const dedupeKey = mintPublishJobId\(/);
  });

  it("produces the same key for the same post, channel and episode", () => {
    const target = { postId: "post-123", channelId: "ch-456", episode: 1 };

    expect(mintPublishJobId(target)).toBe(mintPublishJobId(target));
    expect(mintPublishJobId(target)).toBe("publish-post-123-ch-456-e1");
  });

  it("produces different keys for different channels, and for different episodes", () => {
    const postId = "post-123";

    expect(mintPublishJobId({ postId, channelId: "ch-1", episode: 1 })).not.toBe(
      mintPublishJobId({ postId, channelId: "ch-2", episode: 1 })
    );
    // The episode is what lets a deliberate re-drive reach the queue at all: BullMQ
    // drops an add whose id sits in its retained completed set.
    expect(mintPublishJobId({ postId, channelId: "ch-1", episode: 1 })).not.toBe(
      mintPublishJobId({ postId, channelId: "ch-1", episode: 2 })
    );
  });
});
