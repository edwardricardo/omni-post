/**
 * @file gracefulShutdown.ts
 * @description Helper for wiring SIGTERM/SIGINT handlers in workers. Closes
 *              the BullMQ Worker (waits for active jobs up to its
 *              `closeTimeout`), closes any auxiliary connections, then
 *              disconnects Prisma — in that order, since the Worker may
 *              still issue DB queries while draining.
 *
 *              Idempotent: a second signal during shutdown is ignored. The
 *              process exits with code 0 after teardown.
 * @layer infrastructure
 */

import type { Worker, Queue } from "bullmq";

interface ShutdownLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface ShutdownTarget {
  /** BullMQ Worker(s) to drain. */
  workers?: ReadonlyArray<Worker>;
  /** BullMQ Queue(s) to close (producers, repeatable cron sources). */
  queues?: ReadonlyArray<Queue>;
  /** Auxiliary connections (ioredis, custom pub/sub). */
  connections?: ReadonlyArray<{ quit(): Promise<unknown> }>;
  /** Prisma client to disconnect last. */
  prisma?: { $disconnect(): Promise<void> };
  /** Hook fired after all teardown but before `process.exit`. */
  afterTeardown?: () => Promise<void>;
}

export interface RegisterGracefulShutdownOptions {
  name: string;
  target: ShutdownTarget;
  logger: ShutdownLogger;
}

/**
 * Register `SIGTERM` and `SIGINT` handlers that drain the worker cleanly.
 * Safe to call once per worker process; duplicate signals during shutdown
 * are no-ops (the second one will not double-close anything).
 */
export function registerGracefulShutdown(options: RegisterGracefulShutdownOptions): void {
  const { name, target, logger } = options;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, worker: name }, "Worker shutting down");
    try {
      if (target.workers) {
        await Promise.all(target.workers.map((w) => w.close()));
      }
      if (target.queues) {
        await Promise.all(target.queues.map((q) => q.close()));
      }
      if (target.connections) {
        await Promise.all(
          target.connections.map((c) =>
            c.quit().catch((err) => logger.warn({ err }, "Connection close warning"))
          )
        );
      }
      if (target.prisma) {
        await target.prisma.$disconnect();
      }
      if (target.afterTeardown) {
        await target.afterTeardown();
      }
      logger.info({ worker: name }, "Worker shutdown complete");
    } catch (err) {
      logger.error({ err, worker: name }, "Worker shutdown error");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
