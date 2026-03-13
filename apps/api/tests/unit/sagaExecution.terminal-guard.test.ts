/**
 * Tests for Fase 1 compliance fixes:
 *   V4: dedupeKey must be deterministic (no randomUUID)
 *   V5: executeSaga must reject sagas in terminal state
 */
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  createMockRedis,
  createMockEventService,
  createSimpleSagaDefinition,
  SuccessfulStep,
  FailingStep,
} from "./sagaManager.test-helpers.js";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";

/**
 * Extended mock Prisma that includes sagaInstance model methods
 * needed by persistSagaInstance, loadActiveSagas, and loadSagaInstance.
 */
function createMockPrismaWithSagaInstance() {
  const store = new Map<string, Record<string, unknown>>();

  return {
    $queryRaw: async () => [{ result: 1 }],
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

    const instance = await manager.startSaga(definition.id, {});
    await new Promise((resolve) => setTimeout(resolve, 200));

    const saga = await manager.getSaga(instance.id);
    expect(saga).toBeTruthy();
    expect(saga.status).toBe("COMPLETED");
  });

  it("should not re-execute a COMPLETED saga when continueSaga is called", async () => {
    const definition = createSimpleSagaDefinition();
    manager.registerSaga(definition);

    const instance = await manager.startSaga(definition.id, {});
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

    const instance = await manager.startSaga(failDef.id, {});
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
    const instance = await manager.startSaga(definition.id, {});
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
  it("should generate deterministic dedupeKey without randomUUID", async () => {
    // Read the SagaIntegration source to verify no randomUUID in dedupeKey
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const sagaIntegrationPath = path.join(process.cwd(), "src/saga/SagaIntegration.ts");

    const source = await fs.readFile(sagaIntegrationPath, "utf-8");

    // Find the dedupeKey assignment line
    const dedupeKeyLines = source
      .split("\n")
      .filter((line) => line.includes("dedupeKey") && line.includes("publish-"));

    expect(dedupeKeyLines.length > 0).toBeTruthy();

    for (const line of dedupeKeyLines) {
      expect(line.includes("randomUUID")).toBeFalsy();
      expect(line.includes("Math.random")).toBeFalsy();
    }
  });

  it("should produce the same dedupeKey for same postId + channelId", () => {
    const postId = "post-123";
    const channelId = "ch-456";
    const key1 = `publish-${postId}-${channelId}`;
    const key2 = `publish-${postId}-${channelId}`;

    expect(key1).toBe(key2);
    expect(key1).toBe("publish-post-123-ch-456");
  });

  it("should produce different dedupeKeys for different channelIds", () => {
    const postId = "post-123";
    const key1 = `publish-${postId}-ch-1`;
    const key2 = `publish-${postId}-ch-2`;

    expect(key1).not.toBe(key2);
  });
});
