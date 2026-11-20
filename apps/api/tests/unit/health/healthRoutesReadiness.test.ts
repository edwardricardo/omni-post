/**
 * @file healthRoutesReadiness.test.ts
 * @description Pins what `GET /health/ready` answers when a critical dependency yields no status:
 *              a check that failed, and a name no checker was registered under. Each counts as a
 *              dependency that cannot serve, so the route answers 503 and names it.
 * @layer infrastructure
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { err, type Result } from "@shared/types";
import type { DependencyHealth, HealthChecker, HealthCheckConfig } from "@monitoring/health-checks";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

vi.mock("@monitoring/health-checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monitoring/health-checks")>();
  return { ...actual, createHealthCheckManager: vi.fn() };
});

const healthChecks = await import("@monitoring/health-checks");

/**
 * The package's manager, but its check of `redis` fails and `queue` is never registered: the two
 * ways a critical dependency yields no status.
 */
class ManagerWithTwoMissingStatuses extends healthChecks.HealthCheckManager {
  override register(
    name: string,
    checker: HealthChecker,
    options: {
      type: DependencyHealth["type"];
      critical?: boolean;
      config?: Partial<HealthCheckConfig>;
    }
  ): void {
    if (name !== "queue") super.register(name, checker, options);
  }

  override async checkDependency(
    name: string
  ): Promise<Result<DependencyHealth, "NOT_FOUND" | "CHECK_FAILED">> {
    return name === "redis" ? err("CHECK_FAILED") : super.checkDependency(name);
  }
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /health/ready with a critical dependency that yields no status", () => {
  it("answers 503 naming the dependency whose check failed and the one with no checker", async () => {
    const scheduler = new NoopBackgroundTaskScheduler();
    vi.mocked(healthChecks.createHealthCheckManager).mockImplementationOnce(
      () => new ManagerWithTwoMissingStatuses(undefined, scheduler)
    );
    const checker: HealthChecker = { check: async () => ({ status: "healthy", latency: 1 }) };
    const app = Fastify({ logger: false });
    app.withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    apps.push(app);
    const { healthRoutes } = await import("../../../src/health/healthRoutes.js");
    await app.register(healthRoutes, {
      scheduler,
      checkers: {
        database: checker,
        redis: checker,
        cache: checker,
        queue: checker,
        storage: checker,
        providers: checker,
      },
    });

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect({
      statusCode: response.statusCode,
      status: body["status"],
      message: body["message"],
      unhealthyDependencies: body["unhealthyDependencies"],
    }).toEqual({
      statusCode: 503,
      status: "not ready",
      message: "Critical dependencies unhealthy",
      unhealthyDependencies: ["redis", "queue"],
    });
  });
});
