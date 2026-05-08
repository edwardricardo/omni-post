/**
 * @file queue-port-registry.ts
 * @description `QueuePortRegistry` adapter implementation backed by BullMQ.
 *              Memoises queue adapters per name so consumers requesting the
 *              same queue twice get the same `QueuePort` instance and share
 *              a single Redis connection across queues.
 * @layer infrastructure
 */
import type { QueuePort, QueuePortRegistry } from "@ports/core";
import type Redis from "ioredis";
import type { DefaultJobOptions } from "bullmq";
import { createBullMQQueueAdapter, type BullMQQueueAdapter } from "./queue-adapter.js";

export interface BullMQQueuePortRegistryOptions {
  /**
   * Shared Redis connection. The registry passes this to every queue
   * adapter so multiple queues reuse a single socket — recommended pattern
   * from the BullMQ docs (https://docs.bullmq.io/bull/patterns).
   * The registry does not own the connection; callers manage its lifecycle.
   */
  connection: Redis;
  /**
   * Per-queue default job options. Looked up by queue name when
   * `forQueue(name)` constructs an adapter. Lets DI wire sensible retry +
   * cleanup defaults per queue without requiring producers to pass them
   * on every enqueue call.
   *
   * Queues not present in the map fall back to the BullMQ defaults
   * (attempts=1, no backoff).
   */
  defaultJobOptionsByQueue?: Readonly<Record<string, DefaultJobOptions>>;
}

export class BullMQQueuePortRegistry implements QueuePortRegistry {
  private readonly adapters = new Map<string, BullMQQueueAdapter>();
  private readonly connection: Redis;
  private readonly defaultJobOptionsByQueue: Readonly<Record<string, DefaultJobOptions>>;
  private closed = false;

  constructor(options: BullMQQueuePortRegistryOptions) {
    this.connection = options.connection;
    this.defaultJobOptionsByQueue = options.defaultJobOptionsByQueue ?? {};
  }

  forQueue(queueName: string): QueuePort {
    if (this.closed) {
      throw new Error(`QueuePortRegistry is closed; cannot create adapter for "${queueName}"`);
    }
    let adapter = this.adapters.get(queueName);
    if (!adapter) {
      const defaultJobOptions = this.defaultJobOptionsByQueue[queueName];
      adapter = createBullMQQueueAdapter({
        queueName,
        connection: this.connection,
        ...(defaultJobOptions !== undefined && { defaultJobOptions }),
      });
      this.adapters.set(queueName, adapter);
    }
    return adapter;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(Array.from(this.adapters.values()).map((a) => a.close()));
    this.adapters.clear();
  }
}
