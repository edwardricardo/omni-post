/**
 * @file healthRequestHandler.ts
 * @description The request handler of the workers' health and metrics server: `/metrics`,
 *              `/health/live`, `/health/ready`, `/health/detailed` and `/health`. The bootstrap
 *              builds the manager, the registry and the server and hands them in; this module
 *              decides what each route answers.
 * @layer infrastructure
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HealthCheckManager } from "@monitoring/health-checks";
import type { LoggerPort } from "@ports/core";
import { evaluateReadiness, reportStatusCode, type ReadinessProbe } from "./readiness.js";

/** What the handler answers from. */
export interface HealthRequestDependencies {
  /** The health manager: its last report, a check of everything, and one dependency by name. */
  manager: ReadinessProbe & Pick<HealthCheckManager, "getCurrentStatus" | "checkAll">;
  /** Every dependency whose absence makes the process unable to do its job. */
  criticalDependencies: readonly string[];
  /** The metrics registry `/metrics` serves. */
  metrics: { readonly contentType: string; metrics(): Promise<string> };
  /** Where a route that throws is recorded. */
  logger: Pick<LoggerPort, "error">;
}

/**
 * @function createHealthRequestHandler
 * @description Builds the handler of the workers' health server. `/health`, `/health/detailed`
 *   and `/health/ready` answer 200 while what they report on is healthy or degraded and 503
 *   otherwise, the body saying which; an unknown path answers 404 and a route that throws 500.
 * @param dependencies - The manager, the critical dependencies, the metrics registry and the
 *   logger.
 * @returns The handler to pass to `http.createServer`.
 */
export function createHealthRequestHandler(
  dependencies: HealthRequestDependencies
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { manager, criticalDependencies, metrics, logger } = dependencies;

  return async (req, res) => {
    try {
      const url = req.url || "/";

      if (url === "/metrics") {
        res.setHeader("Content-Type", metrics.contentType);
        res.end(await metrics.metrics());
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
          manager,
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
        const report = await manager.checkAll();
        res.setHeader("Content-Type", "application/json");
        res.statusCode = reportStatusCode(report.overall);
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
        const cached = manager.getCurrentStatus();
        const status = cached ?? (await manager.checkAll());
        res.setHeader("Content-Type", "application/json");
        res.statusCode = reportStatusCode(status.overall);
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
  };
}
