/**
 * @file redis.ts
 * @description Provides centralized Redis connection factory supporting both REDIS_URL
 *              (PaaS) and REDIS_HOST/PORT (Docker Compose) configuration styles.
 * @layer infrastructure
 */

import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Get Redis connection URL from environment
 * Supports both REDIS_URL and individual REDIS_HOST/PORT/PASSWORD
 */
export function getRedisUrl(): string {
  // Priority 1: REDIS_URL (Railway, Heroku, etc.)
  if (env.REDIS_URL) {
    return env.REDIS_URL;
  }

  // Priority 2: Individual components (Docker Compose)
  const host = env.REDIS_HOST || "localhost";
  const port = env.REDIS_PORT || "6379";
  const password = env.REDIS_PASSWORD;

  // Build Redis URL
  if (password) {
    return `redis://:${password}@${host}:${port}`;
  }

  return `redis://${host}:${port}`;
}

/**
 * Create a new Redis connection with standard options
 * Uses environment variables for configuration
 *
 * `maxRetriesPerRequest: null` is the canonical signal for a BullMQ Worker
 * connection. When detected, this factory omits `commandTimeout` because
 * BullMQ blocking commands (BZPOPMIN, XREAD BLOCK) legitimately wait
 * indefinitely — any commandTimeout surfaces as spurious "Command timed
 * out" errors even on healthy Redis (BullMQ issue #2619). Worker liveness
 * is enforced via lockDuration + stalledInterval (BullMQ-side) and TCP
 * keepAlive (transport-side).
 *
 * For default (cache / producer) callers, a 5 s commandTimeout fails fast
 * on a hung Redis without stalling request handlers.
 */
export function createRedisConnection(
  options: {
    db?: number;
    maxRetriesPerRequest?: number | null;
  } = {}
): Redis {
  const redisUrl = getRedisUrl();
  const isBullMQWorker = options.maxRetriesPerRequest === null;

  return new Redis(redisUrl, {
    maxRetriesPerRequest: isBullMQWorker ? null : (options.maxRetriesPerRequest ?? 3),
    db: options.db ?? 0,
    lazyConnect: true,
    enableOfflineQueue: true,
    connectTimeout: 10_000,
    ...(isBullMQWorker ? { keepAlive: 30_000 } : { commandTimeout: 5_000 }),
  });
}
