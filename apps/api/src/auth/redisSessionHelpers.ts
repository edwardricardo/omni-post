/**
 * Redis Session Helpers
 *
 * Extracted from authService.ts to keep file size under 800 lines.
 * Provides Redis-backed session management functions including:
 * - Token blacklisting
 * - Session fingerprint storage
 * - Active session tracking
 * - Login attempt recording
 */

import { createHash } from "crypto";
import type Redis from "ioredis";

// Redis key prefixes
const TOKEN_BLACKLIST_PREFIX = "auth:blacklist:";
const SESSION_FINGERPRINT_PREFIX = "auth:fingerprint:";
const LOGIN_ATTEMPTS_PREFIX = "auth:attempts:";
const ACTIVE_SESSIONS_PREFIX = "auth:sessions:";

// Module-level Redis instance (set by index.ts at startup)
let redisInstance: Redis | undefined;

/**
 * Set the Redis instance used by all session helper functions.
 * Called once during application startup from index.ts.
 */
export function setRedisInstance(redis: Redis): void {
  redisInstance = redis;
}

/**
 * Get current Redis instance (used internally by AuthService to check availability).
 */
export function getRedisInstance(): Redis | undefined {
  return redisInstance;
}

/**
 * Check if a token has been blacklisted.
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  if (!redisInstance) return false;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await redisInstance.get(`${TOKEN_BLACKLIST_PREFIX}${tokenHash}`);
  return result === "1";
}

/**
 * Add a token to the blacklist with TTL based on its expiration.
 */
export async function blacklistToken(token: string, exp: number): Promise<void> {
  if (!redisInstance) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const ttl = Math.max(0, exp - Math.floor(Date.now() / 1000));

  if (ttl > 0) {
    await redisInstance.setex(`${TOKEN_BLACKLIST_PREFIX}${tokenHash}`, ttl, "1");
  }
}

/**
 * Store a session fingerprint hash in Redis with the given TTL.
 */
export async function storeSessionFingerprint(
  sessionId: string,
  fingerprintHash: string,
  ttlSeconds: number
): Promise<void> {
  if (!redisInstance) return;
  await redisInstance.setex(
    `${SESSION_FINGERPRINT_PREFIX}${sessionId}`,
    ttlSeconds,
    fingerprintHash
  );
}

/**
 * Retrieve the stored fingerprint hash for a session.
 */
export async function getStoredFingerprint(sessionId: string): Promise<string | null> {
  if (!redisInstance) return null;
  return redisInstance.get(`${SESSION_FINGERPRINT_PREFIX}${sessionId}`);
}

/**
 * Remove a session fingerprint from Redis.
 */
export async function removeSessionFingerprint(sessionId: string): Promise<void> {
  if (!redisInstance) return;
  await redisInstance.del(`${SESSION_FINGERPRINT_PREFIX}${sessionId}`);
}

/**
 * Track an active session for a user (Redis set with TTL).
 */
export async function trackActiveSession(
  userId: string,
  sessionId: string,
  ttlSeconds: number
): Promise<void> {
  if (!redisInstance) return;
  await redisInstance.sadd(`${ACTIVE_SESSIONS_PREFIX}${userId}`, sessionId);
  await redisInstance.expire(`${ACTIVE_SESSIONS_PREFIX}${userId}`, ttlSeconds);
}

/**
 * Get the number of active sessions for a user.
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  if (!redisInstance) return 0;
  return redisInstance.scard(`${ACTIVE_SESSIONS_PREFIX}${userId}`);
}

/**
 * Record a login attempt in Redis for auditing and rate limiting.
 */
export async function recordLoginAttempt(attempt: {
  email: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
}): Promise<void> {
  if (!redisInstance) return;
  const key = `${LOGIN_ATTEMPTS_PREFIX}${attempt.email}:${attempt.ipAddress}`;
  await redisInstance.lpush(key, JSON.stringify(attempt));
  await redisInstance.expire(key, 24 * 60 * 60); // Keep for 24 hours
  await redisInstance.ltrim(key, 0, 99); // Keep last 100 attempts
}

/**
 * Delete all active session tracking for a user (used during bulk revocation).
 */
export async function deleteActiveSessionsKey(userId: string): Promise<void> {
  if (!redisInstance) return;
  await redisInstance.del(`${ACTIVE_SESSIONS_PREFIX}${userId}`);
}
