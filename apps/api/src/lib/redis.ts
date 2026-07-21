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

/**
 * Duplicate a Redis connection for subscribe-mode (pub/sub) use.
 *
 * A subscribe-mode connection blocks indefinitely waiting for messages, so it
 * must carry NO command timeout at all. `parent.duplicate({ commandTimeout: 0 })`
 * is the WRONG way to express that: `0` is not a "disabled" sentinel — ioredis
 * guards on `typeof options.commandTimeout === "number"`, so a `0` (a number)
 * arms a real 0 ms timer that fires the instant SUBSCRIBE/PSUBSCRIBE is issued
 * and surfaces as a spurious "Command timed out" error. ioredis >=5.11 makes
 * this a hard failure (previously it was tolerated background noise against a
 * remote Redis — homelab finding F-1). An assigned `undefined` is equally wrong
 * under `exactOptionalPropertyTypes`.
 *
 * The ONLY correct disable is to OMIT the key entirely. We therefore destructure
 * `commandTimeout` OUT of the parent's resolved options and rebuild the
 * connection from the remainder — mirroring `Redis.duplicate()` (which does
 * `new Redis({ ...this.options })`) so host/port/db/auth/tls/lazyConnect all
 * carry over unchanged, minus the timeout.
 *
 * @param parent - The source connection whose resolved options are cloned.
 * @returns A new, distinct Redis connection with no `commandTimeout` set.
 */
export function duplicateForSubscriber(parent: Redis): Redis {
  const { commandTimeout: _commandTimeout, ...rest } = parent.options;
  return new Redis(rest);
}
