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

/**
 * @function createTestPrismaClient
 * @description Construct a PrismaClient for tests, optionally overriding the
 *              connection string. Throws if neither argument nor `DATABASE_URL`
 *              is set so misconfigured suites fail fast.
 * @param connectionString - Optional override; falls back to `process.env.DATABASE_URL`.
 * @returns A new PrismaClient instance bound to a PrismaPg adapter.
 */
export function createTestPrismaClient(
  connectionString?: string
): InstanceType<typeof PrismaClient> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}
