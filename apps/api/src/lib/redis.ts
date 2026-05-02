/**
 * @file redis.ts
 * @description Provides centralized Redis connection factory supporting both REDIS_URL
 *              (PaaS) and REDIS_HOST/PORT (Docker Compose) configuration styles.
 * @layer infrastructure
 */

import Redis from "ioredis";
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
 */
export function createRedisConnection(
  options: {
    db?: number;
    maxRetriesPerRequest?: number | null;
  } = {}
): Redis {
  const redisUrl = getRedisUrl();

  return new Redis(redisUrl, {
    maxRetriesPerRequest:
      options.maxRetriesPerRequest === null ? null : (options.maxRetriesPerRequest ?? 3),
    db: options.db ?? 0,
    // Enable lazy connect for Railway compatibility (private network not available during build)
    lazyConnect: true,
    // Enable offline queue to prevent connection errors from crashing the app
    enableOfflineQueue: true,
  });
}
