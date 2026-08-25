/**
 * @file consumerPresence.ts
 * @description Health checker answering one question a queue's connection status
 *              cannot: is anything actually CONSUMING this queue. Reads the
 *              broker's own client registry through `QueuePort.health()`, so the
 *              fact is held by the broker rather than self-reported by a process.
 * @layer infrastructure
 */
import type { HealthChecker, HealthCheckResult } from "../types.js";

/** The slice of `QueuePort` this checker needs. */
interface ConsumerPresencePort {
  health(): Promise<{
    ok: boolean;
    value?: { consumers: number | null };
    error?: string;
  }>;
}

/**
 * Reports whether the broker has at least one consumer registered for one queue.
 *
 * Verdicts: `> 0` healthy · `0` unhealthy (nothing is consuming) · `null`
 * unhealthy (the broker cannot answer — UNKNOWN, reported as unknown, never as
 * zero) · port error or throw unhealthy. Failing closed on unknown is
 * deliberate: a readiness gate that advances on an unanswered question is the
 * same green-over-nothing this probe exists to remove.
 *
 * What it CANNOT detect, stated because a probe that overclaims is worse than no
 * probe at all:
 *   - a consumer whose PROCESSOR is wedged (blocked loop, lock held) — its
 *     client registration stays in place. Registration is not throughput.
 *   - a PAUSED consumer — still a registered client.
 *   - STALE registration — the registry reflects sockets the broker has not yet
 *     reaped, so a vanished host or a stopped process can keep its entry until
 *     the keepalive reap (minutes, at common broker defaults).
 *   - it says nothing about any OTHER queue: the match is queue-scoped, which is
 *     also why a consumer on a different queue can never satisfy it.
 *   - on a broker with no client registry the answer is `null`, which fails the
 *     probe closed — correct, but it means "unavailable", not "no consumer".
 */
export class ConsumerPresenceHealthChecker implements HealthChecker {
  constructor(
    private readonly queueName: string,
    private readonly queue: ConsumerPresencePort
  ) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const health = await this.queue.health();
      const latency = Date.now() - startTime;

      if (!health.ok || !health.value) {
        return {
          status: "unhealthy",
          latency,
          message: `Consumer presence on '${this.queueName}' could not be read — the queue's state is unknown, which is not the same as having no consumer`,
          error: health.error ?? "queue health unavailable",
        };
      }

      const consumers = health.value.consumers;

      if (consumers === null) {
        return {
          status: "unhealthy",
          latency,
          message: `Consumer presence on '${this.queueName}' is unknown — the broker cannot answer its client registry, so this is NOT a report of zero consumers`,
          details: { queue: this.queueName, consumers: null },
        };
      }

      if (consumers === 0) {
        return {
          status: "unhealthy",
          latency,
          message: `No process is consuming the '${this.queueName}' queue`,
          details: { queue: this.queueName, consumers: 0 },
        };
      }

      return {
        status: "healthy",
        latency,
        message: `${consumers} consumer(s) registered for '${this.queueName}'`,
        details: { queue: this.queueName, consumers },
      };
    } catch (error: unknown) {
      return {
        status: "unhealthy",
        latency: Date.now() - startTime,
        message: `Consumer presence on '${this.queueName}' could not be read`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
