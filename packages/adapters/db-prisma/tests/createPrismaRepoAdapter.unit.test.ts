/**
 * @file createPrismaRepoAdapter.unit.test.ts
 * @description Unit tests for createPrismaRepoAdapter DI contract.
 *              Verifies that the factory uses the INJECTED PrismaClient,
 *              not the global singleton — guards the line-125 monitorConnection
 *              footgun and the line-183 close() footgun.
 *              Tier 0: no DB, no Redis — pure mock.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createPrismaRepoAdapter } from "../src/index.js";
import type { PrismaClient } from "@infra/prisma";

/**
 * Build a minimal PrismaClient stub with spied methods
 * for testing DI contract.
 */
function makeMockPrismaClient() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    // Model accessors (structural compatibility)
    account: {},
    project: {},
    post: {},
    channel: {},
    publishLog: {},
    analytics: {},
    thread: {},
  } as unknown as PrismaClient;
}

describe("createPrismaRepoAdapter — DI contract (PR1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("construction", () => {
    it("compiles: accepts required prisma field and returns an adapter", () => {
      const mockClient = makeMockPrismaClient();

      // This must not throw — the required prisma field is satisfied
      const adapter = createPrismaRepoAdapter({ prisma: mockClient });

      assert.ok(adapter !== null, "adapter should be constructed");
      assert.ok(typeof adapter.close === "function", "adapter should have close()");
      assert.ok(
        typeof adapter.getDatabaseHealthMetrics === "function",
        "adapter should have getDatabaseHealthMetrics()"
      );
    });
  });

  describe("monitorConnection (line-125 footgun guard)", () => {
    it("calls $queryRaw on the INJECTED client during initial health check", async () => {
      const mockClient = makeMockPrismaClient();

      // Construct without scheduler so initial check fires via void monitorConnection()
      createPrismaRepoAdapter({ prisma: mockClient });

      // Give the async void call time to settle
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockClient.$queryRaw).toHaveBeenCalled();
    });

    it("registers connection monitor with scheduler and uses INJECTED client", async () => {
      const mockClient = makeMockPrismaClient();
      let registeredCallback: (() => Promise<void>) | undefined;

      const mockScheduler = {
        register: vi.fn((_id: string, callback: () => Promise<void>) => {
          registeredCallback = callback;
        }),
        unregister: vi.fn(),
        shutdownAll: vi.fn().mockResolvedValue({ timedOut: false }),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      createPrismaRepoAdapter({
        prisma: mockClient,
        scheduler: mockScheduler as Parameters<typeof createPrismaRepoAdapter>[0]["scheduler"],
      });

      assert.ok(registeredCallback !== undefined, "scheduler.register should have been called");

      // Fire the monitor callback manually
      await registeredCallback!();

      expect(mockClient.$queryRaw).toHaveBeenCalled();
    });
  });

  describe("close() (line-183 footgun guard)", () => {
    it("calls $disconnect on the INJECTED client", async () => {
      const mockClient = makeMockPrismaClient();

      const adapter = createPrismaRepoAdapter({ prisma: mockClient });
      await adapter.close();

      expect(mockClient.$disconnect).toHaveBeenCalledTimes(1);
    });

    it("unregisters the scheduler task on close()", async () => {
      const mockClient = makeMockPrismaClient();
      const mockScheduler = {
        register: vi.fn(),
        unregister: vi.fn(),
        shutdownAll: vi.fn().mockResolvedValue({ timedOut: false }),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const adapter = createPrismaRepoAdapter({
        prisma: mockClient,
        scheduler: mockScheduler as Parameters<typeof createPrismaRepoAdapter>[0]["scheduler"],
      });
      await adapter.close();

      expect(mockScheduler.unregister).toHaveBeenCalledWith("db-prisma-connection-monitor");
      expect(mockClient.$disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
