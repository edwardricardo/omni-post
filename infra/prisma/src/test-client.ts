/**
 * Test-only PrismaClient factory.
 * Creates a new PrismaClient instance with the PrismaPg adapter.
 * Use this in tests that need their own isolated client instance.
 * For most cases, prefer importing `prisma` from "@infra/prisma" instead.
 */
import { PrismaClient } from "../generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

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
