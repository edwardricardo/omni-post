/**
 * @file healthRoutes.ts
 * @description Health check REST endpoints for monitoring and Kubernetes probes including
 *              simple, detailed, liveness, readiness, and per-dependency health checks. The
 *              composition root builds the checkers and passes them in; this module decides
 *              how each dependency is probed and serves the results.
 * @layer infrastructure
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createHealthCheckManager, isUsable, type HealthChecker } from "@monitoring/health-checks";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

/**
 * @function statusCodeFor
 * @description The status code of every health route: 200 when each status it answers about can
 *   serve, healthy or degraded, and 503 when one cannot. The body says which status it was. A
 *   check that gave no status is passed as `undefined` and cannot serve.
 * @param statuses - The statuses the route answers about: one report, or each critical dependency.
 * @returns 200 or 503.
 */
function statusCodeFor(statuses: ReadonlyArray<string | undefined>): 200 | 503 {
  return statuses.every((status) => status !== undefined && isUsable(status)) ? 200 : 503;
}

/** What the composition root hands the health routes. */
interface HealthRoutesOptions {
  /** Runs the periodic checks whose last report `GET /health` answers from. */
  scheduler: BackgroundTaskScheduler;
  /**
   * One checker per probed dependency, under the name `GET /health/dependency/:name` answers
   * to. The root builds each one over the adapter the application itself uses — its
   * repository adapter, its publish queue, the configured storage backend — so a probe
   * reports on the connection that serves traffic.
   */
  checkers: Record<
    "database" | "redis" | "cache" | "queue" | "storage" | "providers",
    HealthChecker
  >;
}

/**
 * @function healthRoutes
 * @description Registers the health routes for monitoring and Kubernetes probes:
 *   `GET /health` (the last refreshed report), `GET /health/detailed`, `GET /health/live`,
 *   `GET /health/ready` and `GET /health/dependency/:name`. The manager behind them refreshes on
 *   the package's timing: every 30 s, every 5 s while the last report is unhealthy, each check in
 *   one attempt. Each route but the liveness probe answers 200 while what it reports on is
 *   healthy or degraded and 503 otherwise (`statusCodeFor`).
 * @param fastify - The Fastify instance the routes are registered on.
 * @param options - The scheduler the refresh runs on and the checker of each probed dependency.
 */
export async function healthRoutes(fastify: FastifyInstance, options: HealthRoutesOptions) {
  const { scheduler, checkers } = options;

  const healthManager = createHealthCheckManager(undefined, scheduler);

  // Register health checkers
  healthManager.register("database", checkers.database, {
    type: "database",
    critical: true,
  });

  healthManager.register("redis", checkers.redis, {
    type: "cache",
    critical: true,
  });

  healthManager.register("cache", checkers.cache, {
    type: "cache",
    critical: false,
  });

  healthManager.register("queue", checkers.queue, {
    type: "queue",
    critical: true,
  });

  healthManager.register("storage", checkers.storage, {
    type: "storage",
    critical: false,
  });

  healthManager.register("providers", checkers.providers, {
    type: "external_api",
    critical: false,
  });

  /**
   * Simple health check, from the last refreshed report: 200 while it is healthy or degraded,
   * 503 when it is unhealthy, and the status says which.
   *
   * This is the fastest health check endpoint.
   */
  const healthResponseSchema = z.object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    timestamp: z.string(),
    uptime: z.number().optional(),
  });
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Simple health check",
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const status = healthManager.getCurrentStatus();

      if (!status) {
        // Health checks not yet initialized, perform quick check
        const quickCheck = await healthManager.checkAll();

        return reply.status(statusCodeFor([quickCheck.overall])).send({
          status: quickCheck.overall,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(statusCodeFor([status.overall])).send({
        status: status.overall,
        timestamp: status.timestamp.toISOString(),
        uptime: status.uptime,
      });
    }
  );

  /**
   * Detailed health check
   * Returns comprehensive health information including all dependencies
   */
  fastify.get(
    "/health/detailed",
    { schema: { tags: ["Health"], summary: "Detailed health check with all dependencies" } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const report = await healthManager.checkAll();

      const statusCode = statusCodeFor([report.overall]);

      return reply.status(statusCode).send({
        ok: report.overall !== "unhealthy",
        status: report.overall,
        score: report.score,
        timestamp: report.timestamp.toISOString(),
        uptime: report.uptime,
        dependencies: report.dependencies.map((dep) => ({
          name: dep.name,
          type: dep.type,
          status: dep.status,
          latency: dep.latency,
          message: dep.message,
          critical: dep.critical,
          lastChecked: dep.lastChecked.toISOString(),
          ...(dep.details && { details: dep.details }),
        })),
        metrics: {
          memory: {
            heapUsed: report.metrics.memory.heapUsed,
            heapTotal: report.metrics.memory.heapTotal,
            external: report.metrics.memory.external,
            rss: report.metrics.memory.rss,
          },
          cpu: report.metrics.cpu,
        },
        alerts: report.alerts.map((alert) => ({
          id: alert.id,
          level: alert.level,
          message: alert.message,
          dependency: alert.dependency,
          timestamp: alert.timestamp.toISOString(),
          acknowledged: alert.acknowledged,
        })),
      });
    }
  );

  /**
   * Kubernetes liveness probe
   * Returns 200 if the application is alive (can serve traffic)
   *
   * This probe should only fail if the application is completely broken.
   * Kubernetes will restart the pod if this fails.
   */
  const liveResponseSchema = z.object({
    status: z.literal("alive"),
    timestamp: z.string(),
    uptime: z.number(),
  });
  fastify.get(
    "/health/live",
    {
      schema: {
        tags: ["Health"],
        summary: "Kubernetes liveness probe",
        response: { 200: liveResponseSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Liveness check is very simple - just verify the process is responsive
      return reply.send({
        status: "alive",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    }
  );

  /**
   * Kubernetes readiness probe
   * Returns 200 while every critical dependency is healthy or degraded, so it still serves
   *
   * This probe checks critical dependencies. If it fails, Kubernetes
   * will stop routing traffic to this pod but won't restart it.
   */
  const readyOkSchema = z.object({
    status: z.literal("ready"),
    timestamp: z.string(),
  });
  const readyFailSchema = z.object({
    status: z.literal("not ready"),
    timestamp: z.string(),
    message: z.string(),
    unhealthyDependencies: z.array(z.string()),
  });
  fastify.get(
    "/health/ready",
    {
      schema: {
        tags: ["Health"],
        summary: "Kubernetes readiness probe",
        response: { 200: readyOkSchema, 503: readyFailSchema },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // Check only critical dependencies for readiness
      const criticalChecks = ["database", "redis", "queue"];

      const results = await Promise.all(
        criticalChecks.map((name) => healthManager.checkDependency(name))
      );
      const statuses = results.map((result) => (result.ok ? result.value.status : undefined));

      if (statusCodeFor(statuses) === 503) {
        const unhealthyDeps = criticalChecks.filter((_name, index) => {
          const status = statuses[index];
          return status === undefined || !isUsable(status);
        });

        return reply.status(503).send({
          status: "not ready",
          timestamp: new Date().toISOString(),
          message: "Critical dependencies unhealthy",
          unhealthyDependencies: unhealthyDeps,
        });
      }

      return reply.send({
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * Individual dependency health check
   * Returns health status of a specific dependency: 200 while it is healthy or degraded
   */
  fastify.get(
    "/health/dependency/:name",
    { schema: { tags: ["Health"], summary: "Individual dependency health check" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsSchema = z.object({ name: z.string() });

      try {
        const { name } = paramsSchema.parse(request.params);
        const result = await healthManager.checkDependency(name);

        if (!result.ok) {
          // This route is public so infrastructure probes and the CI consumer
          // gate can reach it without credentials, which means it must answer
          // only about the name the caller already supplied. Listing every
          // registered dependency handed any anonymous caller the process's
          // full internal topology in one request, for no consumer: the probes,
          // the saga runbook and `tests/testUtils.ts` all ask by name and none
          // of them read such a list.
          if (result.error === "NOT_FOUND") {
            return reply.status(404).send({
              ok: false,
              dependency: name,
              error: `Dependency '${name}' not found`,
            });
          }

          // A checker that threw describes a dependency that EXISTS and is
          // failing. Answering 404 for it told the caller to correct a spelling
          // while the dependency was down, so the two errors get two answers.
          return reply.status(503).send({
            ok: false,
            dependency: name,
            status: "unhealthy",
            error: `Health check for dependency '${name}' failed`,
          });
        }

        const dependency = result.value;

        return reply.status(statusCodeFor([dependency.status])).send({
          ok: isUsable(dependency.status),
          dependency: name,
          status: dependency.status,
          latency: dependency.latency,
          message: dependency.message,
          critical: dependency.critical,
          lastChecked: dependency.lastChecked.toISOString(),
          ...(dependency.details && { details: dependency.details }),
        });
      } catch {
        return reply.status(400).send({
          error: "Invalid dependency name",
        });
      }
    }
  );

  // Start periodic health checks
  healthManager.start();

  // Stop health checks on server shutdown
  fastify.addHook("onClose", async () => {
    healthManager.stop();
  });
}
