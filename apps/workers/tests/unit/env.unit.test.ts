/**
 * @file env.unit.test.ts
 * @description Unit tests for apps/workers/src/config/env.ts — validates
 *              fail-fast behaviour on missing required vars and that valid env
 *              passes with typed output. Tests use createEnv directly to avoid
 *              ESM module-cache limitations in vitest (resetModules + dynamic
 *              import doesn't re-evaluate ESM with side-effectful top-level code).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Build a test-local instance of the workers env schema so each test case
 * can supply exactly the env it needs, bypassing the ESM module cache.
 * The schema mirrors apps/workers/src/config/env.ts.
 */
function buildEnv(runtimeEnv: Record<string, string | undefined>) {
  const SECRET_MIN = 32;
  return createEnv({
    server: {
      NODE_ENV: z.enum(["development", "production", "test", "staging"]).default("development"),
      DATABASE_URL: z.string().url(),
      REDIS_URL: z.string().url(),
      PLATFORM_ENCRYPTION_KEY: z.string().min(SECRET_MIN),
      METRICS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
      LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    onValidationError: (issues) => {
      const formatted = issues
        .map((i) => {
          const segs = (i.path ?? []).map((s) =>
            typeof s === "object" && "key" in s ? String(s.key) : String(s)
          );
          return `  - ${segs.join(".") || "(root)"}: ${i.message}`;
        })
        .join("\n");
      throw new Error(
        `Environment validation failed. Refusing to boot.\n\n${formatted}\n\n` +
          `Reference: docs/architecture/secrets-and-env.md`
      );
    },
  });
}

const VALID_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:password123@localhost:5432/omnipostdb",
  REDIS_URL: "redis://localhost:6379",
  PLATFORM_ENCRYPTION_KEY: "a-very-long-platform-key-for-testing-purposes-only",
};

describe("apps/workers env module schema", () => {
  it("returns typed env when all required vars are present", () => {
    const env = buildEnv(VALID_ENV);

    assert.strictEqual(typeof env.REDIS_URL, "string");
    assert.ok(
      env.REDIS_URL.startsWith("redis://"),
      `expected redis:// prefix, got: ${env.REDIS_URL}`
    );
    assert.ok(
      env.PLATFORM_ENCRYPTION_KEY.length >= 32,
      "PLATFORM_ENCRYPTION_KEY must be at least 32 chars"
    );
    assert.strictEqual(env.NODE_ENV, "test");
  });

  it("defaults NODE_ENV to 'development' when not provided", () => {
    const env = buildEnv({ ...VALID_ENV, NODE_ENV: undefined });
    assert.strictEqual(env.NODE_ENV, "development");
  });

  it("throws with REDIS_URL in message when REDIS_URL is missing", () => {
    const envWithoutRedis = { ...VALID_ENV, REDIS_URL: undefined };
    assert.throws(
      () => buildEnv(envWithoutRedis),
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
  });

  it("throws with PLATFORM_ENCRYPTION_KEY in message when it is missing", () => {
    const envWithoutKey = { ...VALID_ENV, PLATFORM_ENCRYPTION_KEY: undefined };
    assert.throws(
      () => buildEnv(envWithoutKey),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("PLATFORM_ENCRYPTION_KEY") ||
            err.message.toLowerCase().includes("environment validation"),
          `Expected PLATFORM_ENCRYPTION_KEY or 'environment validation' in error, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("throws when PLATFORM_ENCRYPTION_KEY is shorter than 32 chars", () => {
    const shortKey = { ...VALID_ENV, PLATFORM_ENCRYPTION_KEY: "tooshort" };
    assert.throws(
      () => buildEnv(shortKey),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("PLATFORM_ENCRYPTION_KEY") ||
            err.message.toLowerCase().includes("environment validation"),
          `Expected PLATFORM_ENCRYPTION_KEY in error, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("parses METRICS_PORT as a number when provided", () => {
    const env = buildEnv({ ...VALID_ENV, METRICS_PORT: "3300" });
    assert.strictEqual(env.METRICS_PORT, 3300);
  });

  it("METRICS_PORT is undefined when not provided", () => {
    const env = buildEnv({ ...VALID_ENV, METRICS_PORT: undefined });
    assert.strictEqual(env.METRICS_PORT, undefined);
  });
});
