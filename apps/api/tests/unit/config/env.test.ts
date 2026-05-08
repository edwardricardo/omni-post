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
