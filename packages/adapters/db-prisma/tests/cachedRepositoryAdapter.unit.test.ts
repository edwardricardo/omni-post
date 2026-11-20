/**
 * @file cachedRepositoryAdapter.unit.test.ts
 * @description Pins that the cached repository wrapper answers the port's ping from the repository
 *              it wraps on every call, never from its cache: a cached "the database answers" would
 *              keep a health check green over a database that stopped answering.
 *              Tier 0: no DB, no Redis — the wrapper's Redis client connects lazily and is never
 *              asked.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCachedRepositoryAdapter, createPrismaRepoAdapter } from "../src/index.js";
import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

/** A scheduler double, so the base adapter's connection monitor never queries on its own. */
function makeMockScheduler(): BackgroundTaskScheduler {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    shutdownAll: vi.fn().mockResolvedValue({ timedOut: false }),
    getActiveTasks: vi.fn().mockReturnValue([]),
  };
}

describe("createCachedRepositoryAdapter ping()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the wrapped repository on every ping, so a later failure is seen", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ 1: 1 }])
      .mockRejectedValueOnce(new Error("connection refused"));
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const cached = createCachedRepositoryAdapter(
      createPrismaRepoAdapter({ prisma, scheduler: makeMockScheduler() })
    );

    const first = await cached.ping();
    const second = await cached.ping();

    expect({ first, second, queries: queryRaw.mock.calls.length }).toEqual({
      first: { ok: true, value: undefined },
      second: { ok: false, error: "DATABASE_ERROR" },
      queries: 2,
    });
  });
});
