/**
 * @file QueuePortRegistry.ts
 * @description Port that returns a `QueuePort` bound to a specific queue
 *              name. Lets multiple consumers share a single Redis connection
 *              pool while routing each enqueue to its intended queue. The
 *              registry memoises per-name — repeated `forQueue(N)` calls
 *              return the same `QueuePort` instance.
 * @layer domain
 */
import type { QueuePort } from "./QueuePort";

export interface QueuePortRegistry {
  /**
   * Get (or lazily construct) the `QueuePort` bound to `queueName`.
   * Subsequent calls with the same name return the same instance.
   */
  forQueue(queueName: string): QueuePort;

  /**
   * Close all underlying queue/connection resources. Idempotent — safe to
   * call multiple times. After close, `forQueue` throws.
   */
  close(): Promise<void>;
}
