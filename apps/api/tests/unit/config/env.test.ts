/**
 * @file env.test.ts
 * @description Schema-level tests for the typed `env` constant. Imports go
 *              through dynamic `import()` because env.ts evaluates at module
 *              load — we need to control `process.env` before each import.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// dotenv.config() inside env.ts re-injects values from .env.test on import.
// For deterministic tests we need it to be a no-op so that explicit
// process.env mutations are the only source of truth.
vi.mock("dotenv", () => ({
  default: { config: () => ({ parsed: {} }) },
}));

const REQUIRED_BASE_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public",
  SHADOW_DATABASE_URL: "postgresql://u:p@localhost:5432/db_shadow?schema=public",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  CUSTOMER_JWT_SECRET: "c".repeat(32),
  ADMIN_JWT_ACCESS_SECRET: "d".repeat(32),
  ADMIN_JWT_REFRESH_SECRET: "e".repeat(32),
  COOKIE_SECRET: "f".repeat(32),
  PLATFORM_ENCRYPTION_KEY: "g".repeat(32),
  OAUTH_ENCRYPTION_KEY: "h".repeat(32),
} as const;

async function loadEnvWith(overrides: Record<string, string | undefined> = {}): Promise<unknown> {
  vi.resetModules();
  const original = { ...process.env };
  // Delete keys we manage in fixture so prior test state doesn't leak.
  for (const key of Object.keys(REQUIRED_BASE_ENV)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...REQUIRED_BASE_ENV, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    const mod = await import("../../../src/config/env.js");
    return mod.env;
  } finally {
    // Restore process.env to avoid leaking across tests.
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

describe("env schema (apps/api/src/config/env.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("required secrets", () => {
    it("loads when all required keys present and ≥32 chars", async () => {
      const env = (await loadEnvWith()) as { JWT_ACCESS_SECRET: string };
      expect(env.JWT_ACCESS_SECRET).toBe("a".repeat(32));
    });

    it("rejects boot when JWT_ACCESS_SECRET is missing", async () => {
      await expect(loadEnvWith({ JWT_ACCESS_SECRET: undefined })).rejects.toThrow(
        /JWT_ACCESS_SECRET/
      );
    });

    it("rejects boot when JWT_ACCESS_SECRET is < 32 chars", async () => {
      await expect(loadEnvWith({ JWT_ACCESS_SECRET: "short" })).rejects.toThrow(
        /JWT_ACCESS_SECRET/
      );
    });

    it("rejects boot when DATABASE_URL is missing", async () => {
      await expect(loadEnvWith({ DATABASE_URL: undefined })).rejects.toThrow(/DATABASE_URL/);
    });

    it("rejects boot when DATABASE_URL is malformed (not a URL)", async () => {
      await expect(loadEnvWith({ DATABASE_URL: "not-a-url" })).rejects.toThrow(/DATABASE_URL/);
    });
  });

  describe("optional with defaults", () => {
    it("applies PORT default of 3000", async () => {
      const env = (await loadEnvWith({ PORT: undefined })) as { PORT: number };
      expect(env.PORT).toBe(3000);
    });

    it("applies NODE_ENV default of 'development' when unset", async () => {
      const env = (await loadEnvWith({ NODE_ENV: undefined })) as { NODE_ENV: string };
      expect(env.NODE_ENV).toBe("development");
    });

    it("applies LOG_LEVEL default of 'info'", async () => {
      const env = (await loadEnvWith({ LOG_LEVEL: undefined })) as { LOG_LEVEL: string };
      expect(env.LOG_LEVEL).toBe("info");
    });

    it("coerces TRACING_ENABLED='true' to boolean true", async () => {
      const env = (await loadEnvWith({ TRACING_ENABLED: "true" })) as {
        TRACING_ENABLED: boolean;
      };
      expect(env.TRACING_ENABLED).toBe(true);
    });

    it("coerces PORT='5000' to number 5000", async () => {
      const env = (await loadEnvWith({ PORT: "5000" })) as { PORT: number };
      expect(env.PORT).toBe(5000);
    });
  });

  describe("DELETION_RECORD_RETENTION_YEARS (tombstone plaintext retention window)", () => {
    // The .min(1) is the outermost of the retention floor's three enforcement
    // layers (env schema, write-side clamp, database CHECK). These cases pin
    // that the app REFUSES TO BOOT outside the 1..7 window rather than
    // clamping and continuing — a floor the config can talk its way past is
    // not a floor.
    it("applies the 7-year policy default when unset", async () => {
      const env = (await loadEnvWith({ DELETION_RECORD_RETENTION_YEARS: undefined })) as {
        DELETION_RECORD_RETENTION_YEARS: number;
      };
      expect(env.DELETION_RECORD_RETENTION_YEARS).toBe(7);
    });

    it("accepts a value inside the window", async () => {
      const env = (await loadEnvWith({ DELETION_RECORD_RETENTION_YEARS: "3" })) as {
        DELETION_RECORD_RETENTION_YEARS: number;
      };
      expect(env.DELETION_RECORD_RETENTION_YEARS).toBe(3);
    });

    it("rejects boot below the 1-year floor", async () => {
      await expect(loadEnvWith({ DELETION_RECORD_RETENTION_YEARS: "0" })).rejects.toThrow(
        /DELETION_RECORD_RETENTION_YEARS/
      );
    });

    it("rejects boot above the 7-year policy ceiling", async () => {
      await expect(loadEnvWith({ DELETION_RECORD_RETENTION_YEARS: "8" })).rejects.toThrow(
        /DELETION_RECORD_RETENTION_YEARS/
      );
    });

    it("rejects boot on a non-integer window", async () => {
      await expect(loadEnvWith({ DELETION_RECORD_RETENTION_YEARS: "2.5" })).rejects.toThrow(
        /DELETION_RECORD_RETENTION_YEARS/
      );
    });
  });

  describe("emptyStringAsUndefined behaviour (t3-env canon)", () => {
    it("treats KEY='' (empty string) as undefined so defaults apply", async () => {
      const env = (await loadEnvWith({ PORT: "" })) as { PORT: number };
      expect(env.PORT).toBe(3000);
    });

    it("treats LOG_LEVEL='' as undefined so default 'info' applies", async () => {
      const env = (await loadEnvWith({ LOG_LEVEL: "" })) as { LOG_LEVEL: string };
      expect(env.LOG_LEVEL).toBe("info");
    });
  });

  describe("enum constraints", () => {
    it("rejects invalid NODE_ENV value", async () => {
      await expect(loadEnvWith({ NODE_ENV: "wonderland" })).rejects.toThrow(/NODE_ENV/);
    });

    it("rejects invalid STORAGE_PROVIDER value", async () => {
      await expect(loadEnvWith({ STORAGE_PROVIDER: "azure-blob" })).rejects.toThrow(
        /STORAGE_PROVIDER/
      );
    });

    it("rejects invalid PAYMENT_PROVIDER value", async () => {
      await expect(loadEnvWith({ PAYMENT_PROVIDER: "venmo" })).rejects.toThrow(/PAYMENT_PROVIDER/);
    });
  });

  // The trusted-proxy interlock (ADR-0021). These are boot-refusal tests, not
  // value tests: the point is that an inconsistent pair CANNOT produce a running
  // app that quietly picks one of the two models on the operator's behalf.
  describe("trusted-proxy model interlock", () => {
    it("defaults to socket-only when nothing is configured", async () => {
      const env = (await loadEnvWith()) as { TRUSTED_PROXY_MODE: string };
      expect(env.TRUSTED_PROXY_MODE).toBe("socket-only");
    });

    it("accepts trusted-ranges when ranges are configured", async () => {
      const env = (await loadEnvWith({
        TRUSTED_PROXY_MODE: "trusted-ranges",
        TRUSTED_PROXY_RANGES: "10.0.0.0/8",
      })) as { TRUSTED_PROXY_MODE: string; TRUSTED_PROXY_RANGES: string };
      expect(env.TRUSTED_PROXY_MODE).toBe("trusted-ranges");
      expect(env.TRUSTED_PROXY_RANGES).toBe("10.0.0.0/8");
    });

    it("REFUSES to boot when trusted-ranges is selected with no ranges", async () => {
      await expect(
        loadEnvWith({ TRUSTED_PROXY_MODE: "trusted-ranges", TRUSTED_PROXY_RANGES: undefined })
      ).rejects.toThrow(/TRUSTED_PROXY_RANGES/);
    });

    it("REFUSES to boot when trusted-ranges is selected with an empty range list", async () => {
      await expect(
        loadEnvWith({ TRUSTED_PROXY_MODE: "trusted-ranges", TRUSTED_PROXY_RANGES: " , " })
      ).rejects.toThrow(/TRUSTED_PROXY_RANGES/);
    });

    it("REFUSES to boot on a malformed CIDR and names the offending entry", async () => {
      await expect(
        loadEnvWith({
          TRUSTED_PROXY_MODE: "trusted-ranges",
          TRUSTED_PROXY_RANGES: "10.0.0.0/8, 10.0.0.0/99",
        })
      ).rejects.toThrow(/10\.0\.0\.0\/99/);
    });

    it("REFUSES to boot on a hostname — proxy trust is by address, never by name", async () => {
      await expect(
        loadEnvWith({ TRUSTED_PROXY_MODE: "trusted-ranges", TRUSTED_PROXY_RANGES: "edge.internal" })
      ).rejects.toThrow(/edge\.internal/);
    });

    it("REFUSES to boot on socket-only paired with ranges that would never be consulted", async () => {
      await expect(
        loadEnvWith({ TRUSTED_PROXY_MODE: "socket-only", TRUSTED_PROXY_RANGES: "10.0.0.0/8" })
      ).rejects.toThrow(/TRUSTED_PROXY_RANGES/);
    });

    it("rejects an unknown mode rather than falling back to a default", async () => {
      await expect(loadEnvWith({ TRUSTED_PROXY_MODE: "hop-count" })).rejects.toThrow(
        /TRUSTED_PROXY_MODE/
      );
    });

    it("REFUSES to boot when the removed TRUSTED_PROXY_HOP_COUNT is still set", async () => {
      // The removed variable must not be silently ignored: an operator who still
      // sets it believes hop-count trust is in force, and under fastify >= 5.12.1
      // it does nothing at all. Loud migration error, not a no-op.
      await expect(loadEnvWith({ TRUSTED_PROXY_HOP_COUNT: "2" })).rejects.toThrow(
        /TRUSTED_PROXY_HOP_COUNT/
      );
    });

    it("still refuses when the removed variable is set to its old safe default of 0", async () => {
      await expect(loadEnvWith({ TRUSTED_PROXY_HOP_COUNT: "0" })).rejects.toThrow(
        /TRUSTED_PROXY_HOP_COUNT/
      );
    });
  });

  describe("error message format", () => {
    it("includes 'Refusing to boot' phrase to flag intentional fail-fast", async () => {
      await expect(loadEnvWith({ JWT_ACCESS_SECRET: undefined })).rejects.toThrow(
        /Refusing to boot/
      );
    });

    it("references the architecture doc for guidance", async () => {
      await expect(loadEnvWith({ DATABASE_URL: undefined })).rejects.toThrow(
        /docs\/architecture\/secrets-and-env\.md/
      );
    });
  });
});
