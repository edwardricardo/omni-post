/**
 * @file RedisMfaChallengeStoreAdapter.ts
 * @description Redis-backed `MfaChallengeStorePort` for the customer login MFA
 *              challenge. Allowlist model: `issue` = `SET key "1" EX ttl NX`;
 *              `consume` = `DEL key` and reads the delete count, so exactly one
 *              caller per `jti` gets `"CONSUMED"` (count 1) and everyone else gets
 *              `"NOT_FOUND"` (count 0). Single-command atomicity — no Lua, no
 *              GETDEL requirement. This is security state, not a cache: a Redis
 *              fault is a TYPED `err("STORE_ERROR")`, never swallowed, so the gate
 *              fails CLOSED. Constructed only in the composition root on its own
 *              `createRedisConnection()` (mirrors the BF / token-bucket adapters),
 *              keeping an independent failure domain from cache/queue Redis.
 * @layer infrastructure
 */

import type { Redis } from "ioredis";
import { ok, err, type Result } from "@shared/types";
import type { MfaChallengeStorePort, MfaChallengeStoreError } from "@ports/core";
import { authLogger } from "../../lib/logger.js";

/** On-the-wire key namespace for challenge jtis. */
const KEY_PREFIX = "auth:mfa-challenge:";

/**
 * @class RedisMfaChallengeStoreAdapter
 * @description Atomic single-use challenge registry over Redis.
 */
export class RedisMfaChallengeStoreAdapter implements MfaChallengeStorePort {
  constructor(private readonly redis: Redis) {}

  private key(jti: string): string {
    return `${KEY_PREFIX}${jti}`;
  }

  async issue(jti: string, ttlSeconds: number): Promise<Result<void, MfaChallengeStoreError>> {
    try {
      const result = await this.redis.set(this.key(jti), "1", "EX", ttlSeconds, "NX");
      // `SET ... NX` returns "OK" when the key was set, null when it already
      // existed. A collision on a 128-bit jti is not expected; treat a non-OK
      // reply as a store fault so the gate stays fail-closed.
      if (result !== "OK") {
        return err("STORE_ERROR");
      }
      return ok(undefined);
    } catch (error: unknown) {
      authLogger.warn({ err: error }, "MFA challenge store: issue failed");
      return err("STORE_ERROR");
    }
  }

  async consume(jti: string): Promise<Result<"CONSUMED" | "NOT_FOUND", MfaChallengeStoreError>> {
    try {
      const removed = await this.redis.del(this.key(jti));
      return ok(removed === 1 ? "CONSUMED" : "NOT_FOUND");
    } catch (error: unknown) {
      authLogger.warn({ err: error }, "MFA challenge store: consume failed");
      return err("STORE_ERROR");
    }
  }
}
