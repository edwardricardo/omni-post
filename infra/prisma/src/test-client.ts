/**
 * @file test-client.ts
 * @description Test-only PrismaClient factory. Builds a fresh PrismaClient wired
 *              to the PrismaPg adapter so integration tests can hold an isolated
 *              connection without touching the global singleton. Production
 *              code keeps importing `prisma` from `@infra/prisma`.
 * @layer infrastructure
 */
import { PrismaClient } from "../generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PG_SESSION_OPTIONS } from "./client.js";

/**
 * @function createTestPrismaClient
 * @description Construct a PrismaClient for tests, optionally overriding the
 *              connection string. Throws if neither argument nor `DATABASE_URL`
 *              is set so misconfigured suites fail fast.
 * @param connectionString - Optional override; falls back to `process.env.DATABASE_URL`.
 * @param hostileSessionOptions - Startup-packet settings placed BEFORE the
 *   production pin, so a suite can simulate a server or role whose defaults are
 *   wrong and then prove the pin overrides them. PostgreSQL applies repeated
 *   `-c name=value` settings left to right, last one wins, so anything passed
 *   here is beaten by {@link PG_SESSION_OPTIONS} for as long as that pin exists
 *   — and stops being beaten the moment somebody removes it. Nothing outside a
 *   test should pass this.
 * @returns A new PrismaClient instance bound to a PrismaPg adapter.
 */
export function createTestPrismaClient(
  connectionString?: string,
  hostileSessionOptions = ""
): InstanceType<typeof PrismaClient> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // The same session pin production uses. A test client on a different session
  // time zone would evaluate the retention CHECK differently from the API, so a
  // suite could pass over exactly the divergence the pin exists to prevent.
  const options = `${hostileSessionOptions} ${PG_SESSION_OPTIONS}`.trim();
  const adapter = new PrismaPg({ connectionString: url, options });
  return new PrismaClient({ adapter });
}
