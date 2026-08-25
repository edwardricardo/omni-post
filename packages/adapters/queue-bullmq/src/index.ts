/**
 * @file index.ts
 * @description Barrel exports for the `@adapters/queue-bullmq` package —
 *              parametrised producer adapter, parametrised consumer adapter,
 *              `QueuePortRegistry` and `DeadLetterQueuePort` adapters, and
 *              the canonical `QUEUE_NAMES` constants.
 * @layer infrastructure
 */
export {
  createBullMQQueueAdapter,
  GCP_CLIENT_LIST_SENTINEL,
  type BullMQQueueAdapter,
  type BullMQQueueAdapterOptions,
} from "./queue-adapter.js";
export type { ResilienceMetrics } from "./resilience.js";
export {
  createBullMQConsumerAdapter,
  type BullMQConsumerAdapter,
  type BullMQConsumerAdapterOptions,
} from "./consumer-adapter.js";
export {
  BullMQQueuePortRegistry,
  type BullMQQueuePortRegistryOptions,
} from "./queue-port-registry.js";
export {
  BullMQDeadLetterQueueAdapter,
  type BullMQDeadLetterQueueAdapterOptions,
} from "./dead-letter-queue-adapter.js";
export {
  QUEUE_NAMES,
  PUBLISH_PIPELINE_QUEUES,
  type QueueName,
  type PublishPipelineQueue,
} from "./constants.js";
