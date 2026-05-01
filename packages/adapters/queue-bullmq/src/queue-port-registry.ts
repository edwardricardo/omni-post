/**
 * @file queue-port-registry.ts
 * @description `QueuePortRegistry` adapter implementation backed by BullMQ.
 *              Memoises queue adapters per name so consumers requesting the
 *              same queue twice get the same `QueuePort` instance and share
 *              a single Redis connection across queues.
 * @layer infrastructure
 */
import type { QueuePort, QueuePortRegistry } from "@ports/core";
import Redis from "ioredis";
import { createBullMQQueueAdapter, type BullMQQueueAdapter } from "./queue-adapter.js";

export interface BullMQQueuePortRegistryOptions {
  /**
   * Shared Redis connection. The registry passes this to every queue
   * adapter so multiple queues reuse a single socket — recommended pattern
   * from the BullMQ docs (https://docs.bullmq.io/bull/patterns).
   * The registry does not own the connection; callers manage its lifecycle.
   */
  connection: Redis;
}

export class BullMQQueuePortRegistry implements QueuePortRegistry {
  private readonly adapters = new Map<string, BullMQQueueAdapter>();
  private readonly connection: Redis;
  private closed = false;

  constructor(options: BullMQQueuePortRegistryOptions) {
    this.connection = options.connection;
  }

  forQueue(queueName: string): QueuePort {
    if (this.closed) {
      throw new Error(`QueuePortRegistry is closed; cannot create adapter for "${queueName}"`);
    }
    let adapter = this.adapters.get(queueName);
    if (!adapter) {
      adapter = createBullMQQueueAdapter({
        queueName,
        connection: this.connection,
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
