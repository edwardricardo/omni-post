/**
 * @file env-redis-required.test.ts
 * @description Smoke A (e2e env fail-fast guard) — drives the REAL apps/api env
 *              module (`parseApiEnv` from `src/config/env.ts`) to assert it
 *              refuses to boot when `REDIS_URL` is missing, empty, or malformed,
 *              and that a valid `REDIS_URL` parses to a typed value. Exercising
 *              the actual exported factory (not a copy of the schema) makes the
 *              guard RED-able: relaxing the real `REDIS_URL` rule back to
 *              `.optional()` flips the negative cases from throw to pass, which
 *              this suite catches (CWE-798, SECURITY_CANON §Secrets). Replacing a
 *              reimplemented schema with the real one closes the drainTarget-class
 *              vacuity gap (design §8).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseApiEnv } from "../../../src/config/env.js";

/**
 * A fully-valid runtime env covering every REQUIRED apps/api server key, so the
 * only failure under test is the `REDIS_URL` mutation each case applies. Values
 * are throwaway test fixtures (32+ char secrets satisfy `z.string().min(32)`).
 */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:password123@localhost:5432/omnipostdb",
  SHADOW_DATABASE_URL: "postgresql://postgres:password123@localhost:5432/omnipostdb_shadow",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a-very-long-jwt-access-secret-for-testing-only",
  JWT_REFRESH_SECRET: "a-very-long-jwt-refresh-secret-for-testing-only",
  CUSTOMER_JWT_SECRET: "a-very-long-customer-jwt-secret-for-testing-only",
  ADMIN_JWT_ACCESS_SECRET: "a-very-long-admin-access-secret-for-testing-only",
  ADMIN_JWT_REFRESH_SECRET: "a-very-long-admin-refresh-secret-for-testing-only",
  COOKIE_SECRET: "a-very-long-cookie-secret-for-testing-purposes-only",
  PLATFORM_ENCRYPTION_KEY: "a-very-long-platform-encryption-key-testing-only",
  OAUTH_ENCRYPTION_KEY: "a-very-long-oauth-encryption-key-for-testing-only",
};

/**
 * Assert that parsing a given runtime env throws and the error names REDIS_URL
 * (or the generic "environment validation" fail-fast message).
 */
function assertRefusesToBoot(runtimeEnv: Record<string, string | undefined>): void {
  assert.throws(
    () => parseApiEnv(runtimeEnv),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("REDIS_URL") ||
          err.message.toLowerCase().includes("environment validation"),
        `Expected REDIS_URL or 'environment validation' in error, got: ${err.message}`
      );
      return true;
    }
  );
}

describe("apps/api env — REDIS_URL is required (Smoke A: env fail-fast)", () => {
  it("returns a typed REDIS_URL when all required vars are present", () => {
    const env = parseApiEnv(VALID_ENV);
    assert.strictEqual(typeof env.REDIS_URL, "string");
    assert.ok(
      env.REDIS_URL.startsWith("redis://"),
      `expected redis:// prefix, got: ${env.REDIS_URL}`
    );
  });

  it("refuses to boot with REDIS_URL in the message when REDIS_URL is missing", () => {
    assertRefusesToBoot({ ...VALID_ENV, REDIS_URL: undefined });
  });

  it("refuses to boot when REDIS_URL is an empty string (emptyStringAsUndefined)", () => {
    assertRefusesToBoot({ ...VALID_ENV, REDIS_URL: "" });
  });

  it("refuses to boot when REDIS_URL is not a valid URL", () => {
    assertRefusesToBoot({ ...VALID_ENV, REDIS_URL: "not-a-url" });
  });
});
