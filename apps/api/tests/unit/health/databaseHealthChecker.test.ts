/**
 * @file databaseHealthChecker.test.ts
 * @description Pins what `DatabaseHealthChecker` asks the database and how it grades the answer.
 *              The check is one cheap question, so its latency measures the connection and never
 *              the size of a table; the one-second degraded threshold and the fields of the report
 *              are pinned as `/health/detailed` passes them on.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { DatabaseHealthChecker } from "@monitoring/health-checks";

/**
 * A database double that answers its ping after `elapsedMs` of the faked clock. It also carries
 * an account listing, so a check that still lists accounts is seen doing it.
 */
function makeDatabase(answer: Result<void, "DATABASE_ERROR">, elapsedMs = 0) {
  return {
    ping: vi.fn(async (): Promise<Result<void, "DATABASE_ERROR">> => {
      vi.setSystemTime(Date.now() + elapsedMs);
      return answer;
    }),
    listAccounts: vi.fn(async () => ok([])),
  };
}

describe("DatabaseHealthChecker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings the database once and never lists its accounts", async () => {
    const database = makeDatabase(ok(undefined));

    const result = await new DatabaseHealthChecker(database).check();

    expect({
      status: result.status,
      pings: database.ping.mock.calls.length,
      listings: database.listAccounts.mock.calls.length,
    }).toEqual({ status: "healthy", pings: 1, listings: 0 });
  });

  it("reports unhealthy when the database does not answer the ping", async () => {
    const database = makeDatabase(err("DATABASE_ERROR"));

    const result = await new DatabaseHealthChecker(database).check();

    expect({ status: result.status, message: result.message }).toEqual({
      status: "unhealthy",
      message: "Database connection failed",
    });
  });

  it("reports degraded above one second and healthy at exactly one second", async () => {
    const slow = await new DatabaseHealthChecker(makeDatabase(ok(undefined), 1001)).check();
    const atThreshold = await new DatabaseHealthChecker(makeDatabase(ok(undefined), 1000)).check();

    expect({ slow: slow.status, atThreshold: atThreshold.status }).toEqual({
      slow: "degraded",
      atThreshold: "healthy",
    });
  });

  it("reports its latency, its message and the response time and engine in its details", async () => {
    const result = await new DatabaseHealthChecker(makeDatabase(ok(undefined), 12)).check();

    expect(result).toEqual({
      status: "healthy",
      latency: 12,
      message: "Database is healthy",
      details: {
        responseTime: 12,
        engine: "postgresql",
      },
    });
  });
});
