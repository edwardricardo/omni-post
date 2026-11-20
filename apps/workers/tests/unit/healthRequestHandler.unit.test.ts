/**
 * @file healthRequestHandler.unit.test.ts
 * @description Pins what the workers' health server answers, over HTTP on an ephemeral port:
 *              `/health`, `/health/detailed` and `/health/ready` answer 200 for a healthy or a
 *              degraded report and 503 for an unhealthy one, the body saying which. The handler
 *              runs over the package's own health manager, whose every checker reports the
 *              status a case gives, on a scheduler the case drives.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  HealthCheckManager,
  type HealthChecker,
  type HealthStatus,
} from "@monitoring/health-checks";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createHealthRequestHandler } from "../../src/health/healthRequestHandler.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  );
});

/**
 * The workers' health server over a manager whose two critical dependencies, the database and
 * Redis, report `status`, refreshed once so `/health` answers from the cached report.
 */
async function serverReporting(status: HealthStatus): Promise<string> {
  const scheduler = new NoopBackgroundTaskScheduler();
  const manager = new HealthCheckManager(undefined, scheduler);
  const checker: HealthChecker = { check: async () => ({ status, latency: 1 }) };
  manager.register("database", checker, { type: "database", critical: true });
  manager.register("redis", checker, { type: "cache", critical: true });
  manager.start();
  await scheduler.triggerTask("health-check-manager-periodic");
  const server = createServer(
    createHealthRequestHandler({
      manager,
      criticalDependencies: ["database", "redis"],
      metrics: { contentType: "text/plain", metrics: async () => "" },
      logger: { error: () => {} },
    })
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  return `http://127.0.0.1:${address.port}`;
}

/** A path's status code and its body's status field. */
async function answer(base: string, path: string): Promise<[number, unknown]> {
  const response = await fetch(`${base}${path}`);
  const body = (await response.json()) as { status?: unknown };
  return [response.status, body.status];
}

const STATUSES = ["healthy", "degraded", "unhealthy"] as const;

/** Every status's answer on one path. */
async function answersOn(path: string): Promise<Record<string, [number, unknown]>> {
  const answers: Record<string, [number, unknown]> = {};
  for (const status of STATUSES)
    answers[status] = await answer(await serverReporting(status), path);
  return answers;
}

describe("the workers' health server", () => {
  it("answers /health with 200 for a healthy or degraded report and 503 for an unhealthy one", async () => {
    expect(await answersOn("/health")).toEqual({
      healthy: [200, "healthy"],
      degraded: [200, "degraded"],
      unhealthy: [503, "unhealthy"],
    });
  });

  it("answers /health/detailed with 200 for a healthy or degraded report and 503 for an unhealthy one", async () => {
    expect(await answersOn("/health/detailed")).toEqual({
      healthy: [200, "healthy"],
      degraded: [200, "degraded"],
      unhealthy: [503, "unhealthy"],
    });
  });

  it("answers /health/ready with ready for healthy or degraded critical dependencies and 503 for unhealthy ones", async () => {
    expect(await answersOn("/health/ready")).toEqual({
      healthy: [200, "ready"],
      degraded: [200, "ready"],
      unhealthy: [503, "not ready"],
    });
  });
});

describe("the refresh interval after an on-demand check", () => {
  it("moves to 5 s when /health/ready records an unhealthy dependency, and back to 30 s once it recovers", async () => {
    const scheduler = new NoopBackgroundTaskScheduler();
    const manager = new HealthCheckManager(undefined, scheduler);
    const state: { status: HealthStatus } = { status: "healthy" };
    manager.register(
      "database",
      { check: async () => ({ status: state.status, latency: 1 }) },
      { type: "database", critical: true }
    );
    manager.start();
    await scheduler.triggerTask("health-check-manager-periodic");
    const server = createServer(
      createHealthRequestHandler({
        manager,
        criticalDependencies: ["database"],
        metrics: { contentType: "text/plain", metrics: async () => "" },
        logger: { error: () => {} },
      })
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port was bound");
    const base = `http://127.0.0.1:${address.port}`;
    const interval = () => scheduler.getTaskMetadata("health-check-manager-periodic")?.intervalMs;

    const before = interval();
    state.status = "unhealthy";
    const ready = await answer(base, "/health/ready");
    const afterTheCheck = { interval: interval(), health: await answer(base, "/health") };
    state.status = "healthy";
    await scheduler.triggerTask("health-check-manager-periodic");
    const afterOneRefresh = { interval: interval(), health: await answer(base, "/health") };

    expect({ before, ready, afterTheCheck, afterOneRefresh }).toEqual({
      before: 30_000,
      ready: [503, "not ready"],
      afterTheCheck: { interval: 5_000, health: [503, "unhealthy"] },
      afterOneRefresh: { interval: 30_000, health: [200, "healthy"] },
    });
  });
});
