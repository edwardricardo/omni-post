/**
 * @file envRefusal.test.ts
 * @description The refusal the API's environment module raises when the schema rejects the
 *   environment: the registry's `ENV_VARIABLES_REFUSED`, which names every refused variable and
 *   never a value, with the schema's own text, each variable with its constraint, as its cause,
 *   which the API's own start shows. Driven through the real `parseApiEnv` with crafted runtime
 *   envs, and through `environmentRefusal`, the function the module's validation handler raises,
 *   with crafted issues. The error is read by its fields, never by its class: the module is loaded
 *   fresh for each case, with its own copy of the registry.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";

// `env.ts` calls `process.loadEnvFile()` on import, which would re-inject an env file over the
// fixture below; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

/** A value the refusal may never carry, planted in every refused variable. */
const PLANTED = "planted-Env-Value-z7m4";

/** Every required variable, with throwaway values, so module load succeeds. */
const BASE_ENV: Record<string, string> = {
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
  DELETION_NAME_DIGEST_KEY_RING:
    '{"1":"1111111111111111111111111111111111111111111111111111111111111111"}',
};

/** An environment with four refused variables, each but the missing one holding `PLANTED`. */
const REFUSED_ENV: Record<string, string | undefined> = {
  ...BASE_ENV,
  JWT_ACCESS_SECRET: undefined,
  DATABASE_URL: `not a url ${PLANTED}`,
  COOKIE_SECRET: PLANTED,
  PORT: PLANTED,
};

/** The variables `REFUSED_ENV` refuses, in name order. */
const REFUSED_VARIABLES = ["COOKIE_SECRET", "DATABASE_URL", "JWT_ACCESS_SECRET", "PORT"];

/**
 * An environment whose one refused variable is refused by a cross-field rule whose constraint
 * quotes the entry it refused: the rules over the whole environment run only once every variable
 * passes its own.
 */
const QUOTED_VALUE_ENV: Record<string, string | undefined> = {
  ...BASE_ENV,
  TRUSTED_PROXY_MODE: "trusted-ranges",
  TRUSTED_PROXY_RANGES: `10.0.0.0/8, ${PLANTED}`,
};

/** The fields every reader of a registered error relies on. */
interface RefusalFields {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly params: unknown;
  readonly cause?: unknown;
}

/** The environment module, loaded with `BASE_ENV` installed and `process.env` restored after. */
async function loadEnvModule() {
  vi.resetModules();
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV);
  try {
    return await import("../../../src/config/env.js");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

/** What `parseApiEnv` raises for a runtime env, read by its fields; undefined when it accepts it. */
async function refusalOf(
  runtimeEnv: Record<string, string | undefined>
): Promise<RefusalFields | undefined> {
  const { parseApiEnv } = await loadEnvModule();
  try {
    parseApiEnv(runtimeEnv);
    return undefined;
  } catch (error: unknown) {
    return error as RefusalFields;
  }
}

/** The text of an error's cause, or an empty string when it has none. */
function causeText(refusal: RefusalFields | undefined): string {
  return refusal?.cause instanceof Error ? refusal.cause.message : "";
}

describe("the API's environment module refuses an environment by the registry's code", () => {
  it("raises ENV_VARIABLES_REFUSED naming each refused variable once, in name order", async () => {
    const refusal = await refusalOf(REFUSED_ENV);

    expect(refusal).toMatchObject({
      name: "RegisteredError",
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: REFUSED_VARIABLES },
      message: `The environment was refused: these variables are missing or not valid: ${REFUSED_VARIABLES.join(", ")}`,
    });
  });

  it("carries no value of a refused variable in its message or its parameters", async () => {
    const refusal = await refusalOf(REFUSED_ENV);

    expect(refusal?.code).toBe("ENV_VARIABLES_REFUSED");
    expect(refusal?.message).not.toContain(PLANTED);
    expect(JSON.stringify(refusal?.params)).not.toContain(PLANTED);
    expect(refusal?.message).not.toContain("not a url");
  });

  it("names only the variable when its constraint quotes the value it refused, which stays in the cause", async () => {
    const refusal = await refusalOf(QUOTED_VALUE_ENV);

    expect({ message: refusal?.message, params: refusal?.params }).toEqual({
      message:
        "The environment was refused: these variables are missing or not valid: TRUSTED_PROXY_RANGES",
      params: { variables: ["TRUSTED_PROXY_RANGES"] },
    });
    expect(causeText(refusal)).toContain(`\n  - TRUSTED_PROXY_RANGES: `);
  });

  it("keeps the schema's text, each refused variable with its constraint, as its cause", async () => {
    const refusal = await refusalOf(REFUSED_ENV);

    const text = causeText(refusal);
    expect(text.startsWith("Environment validation failed. Refusing to boot.\n\n")).toBe(true);
    expect(
      text.endsWith(
        "\n\nReference: docs/architecture/secrets-and-env.md for the complete schema and rotation runbook."
      )
    ).toBe(true);
    for (const variable of REFUSED_VARIABLES) {
      expect(text).toContain(`\n  - ${variable}: `);
    }
  });

  it("accepts the base environment and raises nothing", async () => {
    expect(await refusalOf(BASE_ENV)).toBeUndefined();
  });
});

describe("environmentRefusal", () => {
  it("names a variable by the first segment of each issue's path, once each, in name order", async () => {
    const { environmentRefusal } = await loadEnvModule();

    const refusal = environmentRefusal([
      { message: `range ${PLANTED} is not valid`, path: ["TRUSTED_PROXY_RANGES", 1] },
      { message: "required", path: [{ key: "JWT_ACCESS_SECRET" }] },
      { message: "too short", path: ["TRUSTED_PROXY_RANGES"] },
      { message: "not a URL", path: ["DATABASE_URL"] },
    ]);

    expect({ code: refusal.code, params: refusal.params, message: refusal.message }).toEqual({
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: ["DATABASE_URL", "JWT_ACCESS_SECRET", "TRUSTED_PROXY_RANGES"] },
      message:
        "The environment was refused: these variables are missing or not valid: DATABASE_URL, JWT_ACCESS_SECRET, TRUSTED_PROXY_RANGES",
    });
    expect(refusal.message).not.toContain(PLANTED);
  });

  it("names nothing for an issue with no path and keeps it in its cause under (root)", async () => {
    const { environmentRefusal } = await loadEnvModule();

    const refusal = environmentRefusal([
      { message: "the pair is inconsistent" },
      { message: "the ring is not contiguous", path: [] },
      { message: "required", path: ["REDIS_URL"] },
    ]);

    expect(refusal.params).toEqual({ variables: ["REDIS_URL"] });
    expect(causeText(refusal)).toContain(
      "\n  - (root): the pair is inconsistent\n  - (root): the ring is not contiguous\n  - REDIS_URL: required\n"
    );
  });

  it("names (unnamed) when no issue has a path", async () => {
    const { environmentRefusal } = await loadEnvModule();

    const refusal = environmentRefusal([{ message: "the environment is not an object" }]);

    expect({ params: refusal.params, message: refusal.message }).toEqual({
      params: { variables: ["(unnamed)"] },
      message: "The environment was refused: these variables are missing or not valid: (unnamed)",
    });
  });
});
