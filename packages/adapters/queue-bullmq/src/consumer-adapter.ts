/**
 * @file consumer-adapter.ts
 * @description BullMQ consumer adapter — creates a Worker bound to a single
 *              queue name. Concurrency, removeOnComplete and removeOnFail
 *              are caller-provided. Workers must be closed explicitly via
 *              `Worker.close()`.
 * @layer infrastructure
 */
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { createLogger } from "@observability/logger";
import type { QueueName } from "./constants.js";

const logger = createLogger("adapter:queue-bullmq:consumer");

export interface BullMQConsumerAdapterOptions {
  queueName: QueueName | string;
  concurrency?: number;
  removeOnComplete?: { count: number };
  removeOnFail?: { count: number };
  /**
   * Shared Redis connection, owned and supplied by the composition root. The
   * adapter never self-constructs a connection from `process.env`: it would
   * reintroduce the CWE-798 insecure fallback (SECURITY_CANON §Secrets) and
   * violate the DI canon (ARCHITECTURE_CANON §Dependency Injection — only a
   * composition root may construct an adapter's transport). Worker connections
   * require `maxRetriesPerRequest: null` because BullMQ blocks on `BRPOPLPUSH`
   * indefinitely; the composition root's `createRedisConnection` encodes that.
   *
   * REQUIRED — every consumer caller (apps/api in-process consumers and the
   * apps/workers publish worker) injects a composition-root-owned socket. The
   * TS compiler now enforces injection at every call site; the runtime throw
   * below is belt-and-suspenders for non-TS callers that pass `undefined`
   * through a cast.
   */
  connection: Redis;
}

export interface BullMQConsumerAdapter {
  subscribe(
    handler: (job: { payload: Record<string, unknown>; dedupeKey: string }) => Promise<void>
  ): Promise<Worker>;
  close(): Promise<void>;
}

export function createBullMQConsumerAdapter(
  options: BullMQConsumerAdapterOptions
): BullMQConsumerAdapter {
  if (options.connection === undefined) {
    throw new Error(
      "BullMQ consumer adapter requires an injected Redis connection " +
        "(composition-root-owned). Self-construction from process.env is " +
        "forbidden — see ARCHITECTURE_CANON §Dependency Injection and " +
        "SECURITY_CANON §Secrets."
    );
  }
  const connection = options.connection;

  const concurrency = options.concurrency ?? 5;
  const removeOnComplete = options.removeOnComplete ?? { count: 100 };
  const removeOnFail = options.removeOnFail ?? { count: 50 };

  let worker: Worker | null = null;

  return {
    async subscribe(handler) {
      worker = new Worker(
        options.queueName,
        async (job) => {
          await handler({
            payload: job.data,
            dedupeKey: job.id as string,
          });
        },
        {
          connection,
          concurrency,
          removeOnComplete,
          removeOnFail,
          // BullMQ default lockDuration is 30 s, which is too tight for
          // publishing jobs that wait on social provider APIs. 60 s gives
          // headroom; stalledInterval halved so detection lands on tick 2.
          lockDuration: 60_000,
          stalledInterval: 30_000,
          drainDelay: 5,
        }
      );

      worker.on("error", (error) => {
        logger.error({ err: error, queueName: options.queueName }, "Worker error");
      });

      return worker;
    },

    async close(): Promise<void> {
      try {
        if (worker) {
          await worker.close();
          worker = null;
        }
        // The injected connection is owned by the composition root, which
        // quits it after all consumers drain (see apps/api shutdown order).
        // The adapter never quits a connection it does not own.
        logger.info({ queueName: options.queueName }, "Consumer adapter closed");
      } catch (error) {
        logger.warn({ err: error, queueName: options.queueName }, "Consumer cleanup warning");
      }
    },
  };
}
