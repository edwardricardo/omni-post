/**
 * @file registerBootstrapConnections.ts
 * @description Builds the Redis-backed objects the API bootstrap (`apps/api/src/index.ts`) owns
 *   outside the container: the shared API connection, the publish queue the admin queue routes
 *   use, and the gateway switch processor's worker connection. Each is given the throttled
 *   `error` listener here, so the listener is part of what the bootstrap receives and a unit
 *   case reaches it without booting the platform.
 * @layer infrastructure
 */

import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import {
  createThrottledErrorListener,
  logConnectionErrors,
  type ErrorLogSink,
} from "@observability/logger";
import { createRedisConnection, getRedisUrl } from "../../lib/redis.js";

/**
 * @description Builds the API's shared Redis connection (sessions, rate limiting, the saga
 *   wiring and the performance monitor).
 * @param logger - Logger the connection's errors are written through.
 * @returns The connection.
 */
export function createApiRedisConnection(logger: ErrorLogSink): Redis {
  const connection = createRedisConnection();
  logConnectionErrors(connection, logger, "redis:api");
  return connection;
}

/**
 * @description Builds the gateway switch processor's worker connection. A BullMQ worker blocks on
 *   its connection, so it is built with `maxRetriesPerRequest: null` and no command timeout.
 * @param logger - Logger the connection's errors are written through.
 * @returns The connection.
 */
export function createGatewaySwitchProcessorConnection(logger: ErrorLogSink): Redis {
  const connection = createRedisConnection({ maxRetriesPerRequest: null });
  logConnectionErrors(connection, logger, "redis:gateway-switch-processor");
  return connection;
}

/**
 * @description Builds the publish queue the admin queue routes list, retry and remove jobs of,
 *   which the `QueuePort` does not expose. `lazyConnect` keeps its dedicated connection from
 *   blocking startup when Redis is not yet reachable.
 * @param logger - Logger the queue's errors are written through.
 * @returns The queue; the bootstrap closes it with the app.
 */
export function createAdminPublishQueue(logger: ErrorLogSink): Queue {
  const publishQueueUrl = new URL(getRedisUrl());
  const queue = new Queue(QUEUE_NAMES.PUBLISH, {
    connection: {
      host: publishQueueUrl.hostname || "localhost",
      port: Number(publishQueueUrl.port) || 6379,
      ...(publishQueueUrl.password && { password: publishQueueUrl.password }),
      lazyConnect: true,
      enableOfflineQueue: true,
    },
  });
  queue.on("error", createThrottledErrorListener(logger, "bullmq-queue:admin-publish"));
  return queue;
}
