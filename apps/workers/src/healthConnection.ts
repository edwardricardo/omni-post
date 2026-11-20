/**
 * @file healthConnection.ts
 * @description Builds the workers' health connection: the dedicated Redis client the Redis
 *              health checker pings and the consumer-presence probes run on, separate from the
 *              publish worker's connections so the probe never depends on what it observes. It
 *              is given the throttled `error` listener here, so a unit case reaches the listener
 *              without starting the workers process.
 * @layer infrastructure
 */
import { Redis } from "ioredis";
import { logConnectionErrors, type ErrorLogSink } from "@observability/logger";

/**
 * @description Builds the health connection. Finite retries and a 5 s command timeout are the
 *              failure semantics a probe wants; `lazyConnect` defers the socket to the first
 *              check.
 * @param redisUrl - The validated `REDIS_URL`; there is no fallback.
 * @param logger - Logger the connection's errors are written through.
 * @returns The connection.
 */
export function createHealthRedisConnection(redisUrl: string, logger: ErrorLogSink): Redis {
  const connection = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    commandTimeout: 5_000,
    connectTimeout: 5_000,
  });
  logConnectionErrors(connection, logger, "redis:workers-health");
  return connection;
}
