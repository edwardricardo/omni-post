/**
 * @file queue.ts
 * @description Health checker for background job queue (BullMQ) — reports connection status,
 *              waiting/active/completed/failed counts, and flags degraded state on high backlog.
 * @layer infrastructure
 */
import type { HealthChecker, HealthCheckResult } from "../types.js";

interface QueueAdapter {
  health(): Promise<{
    ok: boolean;
    value?: {
      connected: boolean;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      /** Broker-registered consumers; `null` = the broker cannot answer. */
      consumers: number | null;
    };
    error?: string;
  }>;
}

export class QueueHealthChecker implements HealthChecker {
  constructor(private queue: QueueAdapter) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const health = await this.queue.health();

      if (!health.ok) {
        return {
          status: "unhealthy",
          latency: Date.now() - startTime,
          message: "Queue health check failed",
          error: health.error || "Queue health check returned error",
        };
      }

      const latency = Date.now() - startTime;

      let status: HealthCheckResult["status"] = "healthy";
      let message = "Queue is healthy";

      const queueData = health.value;
      if (!queueData) {
        return {
          status: "unhealthy",
          latency,
          message: "Queue data unavailable",
        };
      }

      if (!queueData.connected) {
        status = "unhealthy";
        message = "Queue is not connected";
      } else {
        if (queueData.waiting > 1000) {
          status = "degraded";
          message = `High number of waiting jobs: ${queueData.waiting}`;
        }

        if (queueData.failed > 100) {
          status = "degraded";
          message = `High number of failed jobs: ${queueData.failed}`;
        }
      }

      return {
        status,
        latency,
        message,
        details: {
          responseTime: latency,
          waiting: queueData.waiting,
          active: queueData.active,
          completed: queueData.completed,
          failed: queueData.failed,
          connected: queueData.connected,
          // Reported, never acted on HERE. A process holding this queue may be
          // a producer, for which zero consumers is a normal deployment fact,
          // not an incident — so the policy belongs to each reader (worker
          // readiness fails closed on it, the API's readiness must not).
          consumers: queueData.consumers,
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Queue health check failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
