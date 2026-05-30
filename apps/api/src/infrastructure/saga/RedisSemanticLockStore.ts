/**
 * @file RedisSemanticLockStore.ts
 * @description Redis-backed implementation of SemanticLockPort for saga
 *              concurrency control (Azure saga §15-20). Uses SET NX EX for
 *              atomic acquisition and a Lua script for holder-gated release.
 *              Tracks per-saga held keys in a Redis set so terminal-state
 *              cleanup (releaseAllForSaga) can drop them in one round trip.
 * @layer infrastructure
 */
import type Redis from "ioredis";
import type { Result } from "@shared/types";
import { ok, err } from "@shared/types";
import type { SemanticLockPort, SemanticLockError } from "@ports/core";
import { logger } from "../../lib/logger.js";

const KEY_PREFIX = "saga:semlock";
const HOLDER_SET_PREFIX = "saga:semlock:holder";

/**
 * Lua: only delete the lock if the current value still matches the holder.
 * Prevents a saga from accidentally releasing a lock that expired and was
 * reacquired by a different saga.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export class RedisSemanticLockStore implements SemanticLockPort {
  constructor(private readonly redis: Redis) {}

  async acquire(
    key: string,
    sagaId: string,
    ttlMs: number
  ): Promise<Result<boolean, SemanticLockError>> {
    try {
      const fullKey = this.lockKey(key);
      // SET key value NX PX ttl — atomic acquire with millisecond TTL.
      const result = await this.redis.set(fullKey, sagaId, "PX", ttlMs, "NX");
      if (result !== "OK") {
        return ok(false);
      }
      // Track ownership for terminal-state cleanup.
      await this.redis.sadd(this.holderSetKey(sagaId), fullKey);
      // Match TTL on the holder set so it cannot leak forever even if the
      // releaseAllForSaga path is somehow skipped (process crash before
      // terminal write).
      await this.redis.pexpire(this.holderSetKey(sagaId), ttlMs);
      return ok(true);
    } catch (error) {
      logger.warn({ err: error, key, sagaId }, "Semantic lock acquire failed");
      return err("CONNECTION_ERROR");
    }
  }

  async release(key: string, sagaId: string): Promise<Result<void, SemanticLockError>> {
    try {
      const fullKey = this.lockKey(key);
      await this.redis.eval(RELEASE_SCRIPT, 1, fullKey, sagaId);
      await this.redis.srem(this.holderSetKey(sagaId), fullKey);
      return ok(undefined);
    } catch (error) {
      logger.warn({ err: error, key, sagaId }, "Semantic lock release failed");
      return err("CONNECTION_ERROR");
    }
  }

  async releaseAllForSaga(sagaId: string): Promise<Result<void, SemanticLockError>> {
    try {
      const setKey = this.holderSetKey(sagaId);
      const heldKeys = await this.redis.smembers(setKey);
      if (heldKeys.length === 0) {
        return ok(undefined);
      }
      // Holder-gated DEL: only release if the value still matches sagaId
      // (otherwise the lock expired and was reacquired by another saga and
      // we must not stomp on it).
      for (const fullKey of heldKeys) {
        await this.redis.eval(RELEASE_SCRIPT, 1, fullKey, sagaId);
      }
      await this.redis.del(setKey);
      return ok(undefined);
    } catch (error) {
      logger.warn({ err: error, sagaId }, "Semantic lock bulk release failed");
      return err("CONNECTION_ERROR");
    }
  }

  private lockKey(key: string): string {
    return `${KEY_PREFIX}:${key}`;
  }

  private holderSetKey(sagaId: string): string {
    return `${HOLDER_SET_PREFIX}:${sagaId}`;
  }
}
