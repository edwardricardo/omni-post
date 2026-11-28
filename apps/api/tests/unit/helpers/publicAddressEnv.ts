/**
 * @file publicAddressEnv.ts
 * @description Fixtures for the public addresses the API's environment schema requires with no
 *   default: `CLIENT_URL` (the client portal), `API_BASE_URL` (the API as a webhook subscription
 *   names it) and `APP_BASE_URL` (the API as a single sign-on callback names it). Each address has a
 *   host of its own, so a case can tell which variable a link was built on.
 *
 *   `withEnvironment` installs an environment for the length of one module load:
 *   `apps/api/src/config/env.ts` validates `process.env` when it is first imported. The suite that
 *   calls it neutralises `process.loadEnvFile` with its own hoisted spy, since only a hoisted spy runs
 *   before that import.
 * @layer infrastructure
 */
import { vi } from "vitest";

/** The public addresses, by variable. */
export interface PublicAddressEnv {
  readonly CLIENT_URL: string;
  readonly API_BASE_URL: string;
  readonly APP_BASE_URL: string;
}

/** The variables that name a public address, in the order the schema declares them. */
export const PUBLIC_ADDRESS_VARIABLES = ["CLIENT_URL", "API_BASE_URL", "APP_BASE_URL"] as const;

/**
 * @function makePublicAddressEnv
 * @description The public addresses of a test environment, one host each.
 * @param overrides - The addresses to replace.
 * @returns Each public address variable with its value.
 */
export function makePublicAddressEnv(overrides: Partial<PublicAddressEnv> = {}): PublicAddressEnv {
  return {
    CLIENT_URL: "https://client.example.test",
    API_BASE_URL: "https://api.example.test",
    APP_BASE_URL: "https://sso.example.test",
    ...overrides,
  };
}

/**
 * @function makeApiEnv
 * @description An environment the API's schema accepts: every variable it requires, with
 *   throwaway values.
 * @param overrides - The variables to replace; an undefined value leaves the variable out.
 * @returns The environment, variable by variable.
 */
export function makeApiEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
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
    ...makePublicAddressEnv(),
    ...overrides,
  };
}

/**
 * @function withEnvironment
 * @description Runs `load` with `environment` installed in `process.env`, then restores the
 *   process's own environment whether `load` resolves or rejects. The module cache is reset first,
 *   so a module that validates the environment when it is imported reads this one.
 * @param environment - The variables to install; an undefined value removes the variable.
 * @param load - Imports the modules under test.
 * @returns What `load` resolves to.
 */
export async function withEnvironment<T>(
  environment: Record<string, string | undefined>,
  load: () => Promise<T>
): Promise<T> {
  vi.resetModules();
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await load();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}
