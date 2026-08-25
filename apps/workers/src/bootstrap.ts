/**
 * @file bootstrap.ts
 * @description Unified entry point that spawns every long-running BullMQ
 *              worker in a single Node process, exposes a shared health +
 *              metrics HTTP server, and coordinates graceful shutdown.
 *              Container image's CMD points here.
 *
 *              Why one process for multiple workers:
 *              - Single container per deployment unit keeps orchestration
 *                simple (one log stream, one metrics endpoint, one
 *                lifecycle).
 *              - Workers don't compete for CPU at idle (BullMQ blocking
 *                BZPOPMIN parks the event loop until a job lands).
 *              - Sharing a Node process avoids paying ~80 MiB baseline
 *                memory per additional worker container.
 *
 *              Each worker module exports `startXxxWorker({ registerShutdown:
 *              false })` which boots its BullMQ Worker + Redis connection
 *              and returns a `ShutdownTarget`. The bootstrap then registers
 *              ONE process-level `SIGTERM`/`SIGINT` handler that drains all
 *              targets together — preventing the race where one worker's
 *              `process.exit(0)` cuts another worker's mid-drain.
 *
 *              Standalone usage of each worker (debugging, one-off runs)
 *              still works: `node dist/mentionIngestWorker.js` etc., because
 *              each file ends with an `import.meta.url` main-module guard
 *              that calls `startXxxWorker()` with default options.
 *
 *              Health server: exposes 4 endpoints aligned with the API canon
 *              de facto (`apps/api/src/health/healthRoutes.ts`):
 *              `/health`, `/health/live`, `/health/ready`, `/health/detailed`,
 *              plus `/metrics` aggregating the publish worker's prom-client
 *              registry with the global one used by health-checks. Port 3300
 *              is the canonical OmniPost worker metrics port (outside
 *              Prometheus's reserved 9090–9999 exporter range — see
 *              `prometheus/prometheus.yml` workers job).
 * @layer infrastructure
 */

import http from "http";
import client from "prom-client";
import { Redis } from "ioredis";
import { createLogger } from "@observability/logger";
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  createHealthCheckManager,
  ConsumerPresenceHealthChecker,
  DatabaseHealthChecker,
  RedisHealthChecker,
} from "@monitoring/health-checks";
import { BullMQQueuePortRegistry, PUBLISH_PIPELINE_QUEUES } from "@adapters/queue-bullmq";
import { workerPrisma } from "./container/workerContainer.js";
import { startPublishWorker } from "./publishWorker.js";
import { startMentionIngestWorker } from "./mentionIngestWorker.js";
import { env } from "./config/env.js";
import { evaluateReadiness, publishConsumerDependencyName } from "./health/readiness.js";
import { registerGracefulShutdown, type ShutdownTarget } from "./lib/gracefulShutdown.js";

const logger = createLogger("workers-bootstrap");

async function main(): Promise<void> {
  logger.info("Bootstrapping workers process");

  const publishHandle = await startPublishWorker({ prisma: workerPrisma, registerShutdown: false });
  const mentionTarget = await startMentionIngestWorker({
    prisma: workerPrisma,
    registerShutdown: false,
  });

  // --- Health check manager + scheduler ---
  // The HealthCheckManager runs registered checkers periodically (interval
  // 30s). Workers' critical deps are database + redis; queue + provider
  // checkers can be added later if needed.
  const healthScheduler = new DefaultBackgroundTaskScheduler({
    logger: {
      error: (msg, data) => logger.error({ data }, msg),
      info: (msg, data) => logger.info({ data }, msg),
      debug: (msg, data) => logger.debug({ data }, msg),
    },
  });

  // Dedicated Redis client for the RedisHealthChecker — does not share
  // the publish worker's saga notifyRedis (different connection lifecycle).
  // Uses env.REDIS_URL — no fallback (SECURITY_CANON §Secrets, CWE-798).
  const healthRedis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    commandTimeout: 5_000,
    connectTimeout: 5_000,
  });
  healthRedis.on("error", () => {
    // Errors surface via the checker's PING failure path.
  });

  const healthManager = createHealthCheckManager(
    { timeout: 5000, interval: 30000, retries: 3 },
    healthScheduler
  );
  healthManager.register("database", new DatabaseHealthChecker(publishHandle.repo), {
    type: "database",
    critical: true,
  });
  healthManager.register("redis", new RedisHealthChecker(healthRedis), {
    type: "cache",
    critical: true,
  });

  // Consumer-presence probes, one per queue the publish pipeline enqueues to.
  // The set comes from PUBLISH_PIPELINE_QUEUES rather than from a literal here,
  // so a queue added to that pipeline adds a readiness requirement by
  // construction. Built on `healthRedis` — finite retries and a 5s command
  // timeout are exactly the failure semantics a probe wants, and sharing the
  // publish worker's own connection would make the probe depend on the thing it
  // is supposed to observe.
  const healthQueueRegistry = new BullMQQueuePortRegistry({ connection: healthRedis });
  const publishConsumerDependencies = PUBLISH_PIPELINE_QUEUES.map((queueName) => {
    const dependencyName = publishConsumerDependencyName(queueName);
    healthManager.register(
      dependencyName,
      new ConsumerPresenceHealthChecker(queueName, healthQueueRegistry.forQueue(queueName)),
      { type: "queue", critical: true }
    );
    return dependencyName;
  });

  /**
   * Every dependency whose absence makes this process unable to do its job. The
   * consumer entries are what turn "the process started" into "the process is
   * attached to the queue" — the distinction a readiness gate exists to draw.
   */
  const criticalDependencies = ["database", "redis", ...publishConsumerDependencies];

  // Aggregate prom-client registries: publish worker's default+worker metrics
  // + the global registry used by `@monitoring/health-checks` for its own
  // gauges/histograms.
  const metricsRegistry = client.Registry.merge([publishHandle.metricsRegistry, client.register]);

  const metricsPort = env.METRICS_PORT ?? 3300;

  const healthServer = http.createServer(async (req, res) => {
    try {
      const url = req.url || "/";

      if (url === "/metrics") {
        res.setHeader("Content-Type", metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
        return;
      }

      if (url === "/health/live") {
        res.setHeader("Content-Type", "application/json");
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: "alive",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
          })
        );
        return;
      }

      if (url === "/health/ready") {
        // Asked one name at a time, NOT by filtering a whole-report scan: a
        // critical name with no registered checker contributes zero entries to
        // such a filter, and zero unhealthy entries reads as ready — a 200 over
        // a dependency nobody checked. Per-name lookup makes that a NOT_FOUND,
        // so the gate fails closed on its own wiring mistakes.
        const { ready, unhealthyDependencies } = await evaluateReadiness(
          healthManager,
          criticalDependencies
        );

        res.setHeader("Content-Type", "application/json");
        if (ready) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              status: "ready",
              timestamp: new Date().toISOString(),
            })
          );
        } else {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              status: "not ready",
              timestamp: new Date().toISOString(),
              message: `Unhealthy critical dependencies: ${unhealthyDependencies.join(", ")}`,
              unhealthyDependencies,
            })
          );
        }
        return;
      }

      if (url === "/health/detailed") {
        const report = await healthManager.checkAll();
        const statusCode = report.overall === "unhealthy" ? 503 : 200;
        res.setHeader("Content-Type", "application/json");
        res.statusCode = statusCode;
        res.end(
          JSON.stringify({
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
            })),
            metrics: report.metrics,
            alerts: report.alerts,
          })
        );
        return;
      }

      if (url === "/health") {
        const cached = healthManager.getCurrentStatus();
        const status = cached ?? (await healthManager.checkAll());
        const isHealthy = status.overall === "healthy";
        res.setHeader("Content-Type", "application/json");
        res.statusCode = isHealthy ? 200 : 503;
        res.end(
          JSON.stringify({
            status: status.overall,
            timestamp: status.timestamp.toISOString(),
            uptime: status.uptime,
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end();
    } catch (err) {
      logger.error({ err, url: req.url }, "Health endpoint handler failed");
      res.statusCode = 500;
      res.end();
    }
  });

  healthServer.listen(metricsPort, () => {
    healthManager.start();
    logger.info({ metricsPort }, "Unified health/metrics server listening");
  });

  // Merge the per-worker shutdown targets into one. Order matters during drain:
  // workers first (drain in-flight jobs), then queues, then connections, then
  // prisma, then afterTeardown hooks (custom cleanup). The composed `afterTeardown`
  // stops the health manager + closes the server, then runs every worker's hook
  // in sequence so each closes its own consumer / scheduler.
  const targets = [publishHandle.target, mentionTarget];
  const composed: ShutdownTarget = {
    workers: targets.flatMap((t) => t.workers ?? []),
    queues: targets.flatMap((t) => t.queues ?? []),
    connections: [...targets.flatMap((t) => t.connections ?? []), healthRedis],
    afterTeardown: async (): Promise<void> => {
      healthManager.stop();
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      // Closes the probe's BullMQ queues before `healthRedis` is quit; the
      // registry never owns the connection it was handed.
      await healthQueueRegistry.close();
      const schedulerResult = await healthScheduler.shutdownAll();
      if (schedulerResult.timedOut) {
        logger.warn({ schedulerResult }, "Health scheduler shutdown timed out");
      }
      for (const t of targets) {
        if (t.afterTeardown) {
          await t.afterTeardown();
        }
      }
    },
  };

  // Use the first non-undefined `prisma` from any target. All workers share
  // the same `@infra/prisma` singleton, so any reference disconnects it once.
  const prismaTarget = targets.find((t) => t.prisma !== undefined)?.prisma;
  if (prismaTarget) {
    composed.prisma = prismaTarget;
  }

  registerGracefulShutdown({ name: "workers-bootstrap", target: composed, logger });

  logger.info(
    { workers: ["publish", "mention-ingest"] },
    "All workers started; bootstrap idle (waiting on signals)"
  );
}

main().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});
