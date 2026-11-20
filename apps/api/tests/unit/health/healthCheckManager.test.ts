/**
 * @file healthCheckManager.test.ts
 * @description Pins how `HealthCheckManager` refreshes the report `/health` answers from and how a
 *              failing check ends. The refresh runs every 30 s while the last report is healthy or
 *              degraded and every 5 s while it is unhealthy, so a recovered dependency shows within
 *              seconds; a check makes one attempt bounded by its timeout, because the next refresh
 *              is the retry.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HealthCheckManager,
  type HealthChecker,
  type HealthCheckResult,
  type HealthStatus,
} from "@monitoring/health-checks";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

/** The id the manager registers its refresh under. */
const REFRESH_TASK = "health-check-manager-periodic";

/** A checker double whose answer the test can change between refreshes. */
function makeChecker(initial: HealthStatus) {
  const state = { status: initial };
  const checker = {
    check: vi.fn(async (): Promise<HealthCheckResult> => ({ status: state.status, latency: 1 })),
  } satisfies HealthChecker;
  return { checker, state };
}

/** A started manager over one critical dependency, on a scheduler the test drives. */
function startManager(checker: HealthChecker) {
  const scheduler = new NoopBackgroundTaskScheduler();
  const manager = new HealthCheckManager(undefined, scheduler);
  manager.register("database", checker, { type: "database", critical: true });
  manager.start();
  return { scheduler, manager };
}

/** The interval the refresh task is armed with now. */
function cadenceOf(scheduler: NoopBackgroundTaskScheduler): number | undefined {
  return scheduler.getTaskMetadata(REFRESH_TASK)?.intervalMs;
}

describe("HealthCheckManager refresh cadence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts refreshing every 30 s, the first refresh run at once", () => {
    const { scheduler } = startManager(makeChecker("healthy").checker);

    const task = scheduler.getTaskMetadata(REFRESH_TASK);

    expect({ intervalMs: task?.intervalMs, immediate: task?.options?.immediate }).toEqual({
      intervalMs: 30_000,
      immediate: true,
    });
  });

  it("refreshes every 5 s once a report is unhealthy", async () => {
    const { scheduler } = startManager(makeChecker("unhealthy").checker);

    await scheduler.triggerTask(REFRESH_TASK);

    expect(cadenceOf(scheduler)).toBe(5_000);
  });

  it("returns to every 30 s once a report is healthy again", async () => {
    const { checker, state } = makeChecker("unhealthy");
    const { scheduler } = startManager(checker);

    await scheduler.triggerTask(REFRESH_TASK);
    const whileUnhealthy = cadenceOf(scheduler);
    state.status = "healthy";
    await scheduler.triggerTask(REFRESH_TASK);

    expect({ whileUnhealthy, afterRecovery: cadenceOf(scheduler) }).toEqual({
      whileUnhealthy: 5_000,
      afterRecovery: 30_000,
    });
  });

  it("keeps refreshing every 30 s after a degraded report", async () => {
    const { scheduler } = startManager(makeChecker("degraded").checker);

    await scheduler.triggerTask(REFRESH_TASK);

    expect(cadenceOf(scheduler)).toBe(30_000);
  });

  it("does not re-arm a refresh that completes after the manager stopped", async () => {
    let answer: (result: HealthCheckResult) => void = () => {};
    const checker: HealthChecker = {
      check: () =>
        new Promise<HealthCheckResult>((resolve) => {
          answer = resolve;
        }),
    };
    const { scheduler, manager } = startManager(checker);

    const refresh = scheduler.triggerTask(REFRESH_TASK);
    manager.stop();
    answer({ status: "unhealthy", latency: 1 });
    await refresh;

    expect(scheduler.getActiveTasks()).toEqual([]);
  });
});

describe("HealthCheckManager check attempts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes exactly one attempt when a check fails", async () => {
    const checker = {
      check: vi.fn(async (): Promise<HealthCheckResult> => {
        throw new Error("connection refused");
      }),
    } satisfies HealthChecker;
    const manager = new HealthCheckManager(undefined, new NoopBackgroundTaskScheduler());
    manager.register("redis", checker, { type: "cache", critical: true });

    const pending = manager.checkDependency("redis");
    await vi.runAllTimersAsync();
    const result = await pending;

    expect({
      status: result.ok ? result.value.status : result.error,
      error: result.ok ? result.value.details["error"] : undefined,
      attempts: checker.check.mock.calls.length,
    }).toEqual({ status: "unhealthy", error: "connection refused", attempts: 1 });
  });

  it("gives up on a check that never answers at the 5 s timeout, once", async () => {
    const checker = {
      check: vi.fn(() => new Promise<HealthCheckResult>(() => {})),
    } satisfies HealthChecker;
    const manager = new HealthCheckManager(undefined, new NoopBackgroundTaskScheduler());
    manager.register("queue", checker, { type: "queue", critical: true });

    let settled = false;
    const pending = manager.checkDependency("queue").finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    const settledBeforeTimeout = settled;
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect({
      settledBeforeTimeout,
      status: result.ok ? result.value.status : result.error,
      error: result.ok ? result.value.details["error"] : undefined,
      attempts: checker.check.mock.calls.length,
    }).toEqual({
      settledBeforeTimeout: false,
      status: "unhealthy",
      error: "Health check timeout",
      attempts: 1,
    });
  });

  it("reports a passing check's own status, message and details under its dependency", async () => {
    const checker: HealthChecker = {
      check: async () => ({
        status: "degraded",
        latency: 3,
        message: "Redis response time elevated",
        details: { connectedClients: 4 },
      }),
    };
    const manager = new HealthCheckManager(undefined, new NoopBackgroundTaskScheduler());
    manager.register("redis", checker, { type: "cache", critical: false });

    const result = await manager.checkDependency("redis");

    // The faked clock stands still, so the measured latency is 0.
    expect(result.ok ? result.value : result.error).toEqual({
      name: "redis",
      type: "cache",
      status: "degraded",
      latency: 0,
      message: "Redis response time elevated",
      details: { connectedClients: 4 },
      lastChecked: expect.any(Date),
      critical: false,
    });
  });
});
