/**
 * Shared test helpers for bruteForceProtection tests.
 *
 * Key isolation strategy:
 * Each test file that runs concurrently must pass a unique `keyNamespace` to
 * BruteForceProtection so their Redis keys never overlap.  The namespace is
 * included in every key prefix used by the service, e.g.:
 *   "<namespace>:bf:email:<email>"
 *
 * The test-helpers file also provides a cleanup helper that only removes keys
 * matching the namespace, so concurrent test processes cannot accidentally
 * delete each other's keys.
 *
 * @file bruteForceProtection.test-helpers.ts
 * @description Test helpers for brute force protection test helpers
 * @layer infrastructure
 */
import Redis from "ioredis";
import type { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import type { BruteForceConfig } from "../../src/auth/bruteForceProtection.js";

export const mockMetrics = {
  metrics: {
    securityThreats: {
      inc: () => {},
    },
  },
} as unknown as ApiMetrics;

export function makeTestConfig(keyNamespace: string): Partial<BruteForceConfig> {
  return {
    maxFailedAttemptsPerEmail: 3,
    maxFailedAttemptsPerIp: 10,
    failureWindowMinutes: 5,
    baseDelaySeconds: 1,
    maxDelaySeconds: 60,
    exponentialBase: 2,
    lockoutThreshold: 5,
    lockoutDurationMinutes: 10,
    lockoutWindowHours: 1,
    ipBlockThreshold: 15,
    ipBlockDurationMinutes: 20,
    captchaThreshold: 2,
    captchaEnabled: true,
    anomalyDetectionEnabled: true,
    suspiciousActivityThreshold: 5,
    keyNamespace,
  };
}

export function makeTestRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    db: 15, // Dedicated DB for brute force protection tests
  });
}

/**
 * Remove all keys belonging to a specific test namespace.
 * Only touches keys that start with "<namespace>:bf:" or
 * "<namespace>:login_attempts:" so concurrent files cannot affect each other.
 * The login_attempts prefix is now namespace-aware (matches the service change).
 */
export async function cleanupRedis(redis: Redis, namespace: string): Promise<void> {
  const namespaceKeys = await redis.keys(`${namespace}:bf:*`);
  const loginKeys = await redis.keys(`${namespace}:login_attempts:*`);
  const all = [...namespaceKeys, ...loginKeys];
  if (all.length > 0) {
    await redis.del(...all);
  }
}

export const testUserAgent = "Mozilla/5.0 (Test)";
