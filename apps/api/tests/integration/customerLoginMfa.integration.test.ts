/**
 * @file customerLoginMfa.integration.test.ts
 * @description Integration test for the customer login MFA challenge store against
 *              a REAL Redis (mfa-consolidation PR2b-3). Proves the merge-blocking
 *              single-use guarantee the unit fakes can only approximate: on a real
 *              Redis instance, two concurrent `consume` of one challenge `jti`
 *              yield EXACTLY ONE `CONSUMED` (the `DEL`-count serializer), the
 *              second sequential consume is `NOT_FOUND`, and TTL expiry drops a
 *              pending challenge. The full HTTP enroll→login→challenge→complete
 *              cycle is exercised by the route-level tests + the existing
 *              `mfaCustomer.integration.test.ts` harness (which requires a running
 *              API on 3000); this file isolates the store's atomicity contract,
 *              which needs only Redis.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import path from "path";
import dotenv from "dotenv";

// Load .env.test BEFORE importing modules that read the typed env at import time.
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

const { Redis } = await import("ioredis");
const { RedisMfaChallengeStoreAdapter } =
  await import("../../src/infrastructure/adapters/RedisMfaChallengeStoreAdapter.js");

function resolveRedisUrl(): string {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || "localhost";
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD;
  return password ? `redis://:${password}@${host}:${port}` : `redis://${host}:${port}`;
}

describe("RedisMfaChallengeStoreAdapter — real Redis single-use", () => {
  let redis: InstanceType<typeof Redis>;
  let adapter: InstanceType<typeof RedisMfaChallengeStoreAdapter>;

  before(() => {
    redis = new Redis(resolveRedisUrl(), { maxRetriesPerRequest: 3 });
    adapter = new RedisMfaChallengeStoreAdapter(redis);
  });

  after(async () => {
    await redis.quit();
  });

  it("issues a jti and consumes it exactly once (second consume → NOT_FOUND)", async () => {
    const jti = randomBytes(16).toString("hex");

    const issued = await adapter.issue(jti, 60);
    assert.ok(issued.ok, "issue should succeed");

    const first = await adapter.consume(jti);
    assert.ok(first.ok && first.value === "CONSUMED", "first consume wins");

    const second = await adapter.consume(jti);
    assert.ok(second.ok && second.value === "NOT_FOUND", "second consume finds nothing");
  });

  it("two concurrent consume on real Redis → exactly one CONSUMED", async () => {
    const jti = randomBytes(16).toString("hex");
    await adapter.issue(jti, 60);

    const results = await Promise.all([
      adapter.consume(jti),
      adapter.consume(jti),
      adapter.consume(jti),
    ]);

    const consumed = results.filter((r) => r.ok && r.value === "CONSUMED");
    const notFound = results.filter((r) => r.ok && r.value === "NOT_FOUND");
    assert.strictEqual(consumed.length, 1, "exactly one caller consumes the challenge");
    assert.strictEqual(notFound.length, 2, "the other two lose the race");
  });

  it("drops an expired challenge (TTL): consume after expiry is NOT_FOUND", async () => {
    const jti = randomBytes(16).toString("hex");
    await adapter.issue(jti, 1);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    const consumed = await adapter.consume(jti);
    assert.ok(consumed.ok && consumed.value === "NOT_FOUND", "expired jti is gone");
  });
});
