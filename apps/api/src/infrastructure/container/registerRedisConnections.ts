/**
 * @file registerRedisConnections.ts
 * @description Registers the role-separated, composition-root-owned Redis
 *              connections in the DI container. Extracted from `setupServices`
 *              as a small testable seam so the wiring smoke drives the REAL
 *              registration (not a reimplementation): both the production boot
 *              path and the integration test call THIS exact function.
 * @layer infrastructure
 */
import type { Redis } from "ioredis";
import { logConnectionErrors } from "@observability/logger";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { createRedisConnection } from "../../lib/redis.js";
import { createLogger } from "../../lib/logger.js";

/**
 * @function registerRedisConnections
 * @description Registers the three role-separated Redis connection singletons,
 *   each built via the validated `createRedisConnection` factory (no literal,
 *   no `process.env` fallback). BullMQ canon (docs.bullmq.io/guide/connections):
 *   worker and subscriber connections require `maxRetriesPerRequest: null`;
 *   counters use the finite-retry default. Each is a singleton; lifecycle
 *   (quit) is owned by the apps/api shutdown handler. Each connection writes its
 *   errors through a throttled listener on the `redis` logger, which also reports
 *   when it is ready again: an ioredis client with no `error` listener writes every
 *   reconnection error with console.error.
 *
 *   - `BullMQWorkerConnection` — shared by all in-process BullMQ consumers
 *     (Worker requirement: null retries + keepAlive, no commandTimeout since
 *     BullMQ blocks on BRPOPLPUSH indefinitely).
 *   - `SagaSubscriberConnection` — long-lived pub/sub subscriber for the saga
 *     event channel (subscriber mode blocks; same null-retry shape).
 *   - `AnalyticsRedisConnection` — distributed-counter connection for the
 *     ROICalculator (regular commands — finite retries + commandTimeout).
 *
 * @param container - The DI container to register the connections into.
 */
export function registerRedisConnections(container: Container): void {
  const redisLogger = createLogger("redis");
  const listened = (connection: Redis, name: string): Redis => {
    logConnectionErrors(connection, redisLogger, name);
    return connection;
  };

  container.register<Redis>(
    TOKENS.BullMQWorkerConnection,
    () => listened(createRedisConnection({ maxRetriesPerRequest: null }), "redis:bullmq-worker"),
    true
  );
  container.register<Redis>(
    TOKENS.SagaSubscriberConnection,
    () => listened(createRedisConnection({ maxRetriesPerRequest: null }), "redis:saga-subscriber"),
    true
  );
  container.register<Redis>(
    TOKENS.AnalyticsRedisConnection,
    () => listened(createRedisConnection(), "redis:analytics"),
    true
  );
}
