/**
 * Adapters Integration Tests
 *
 * Tests infrastructure adapters including:
 * - Publish log reads honouring their limit
 * - Repository pattern database operations
 * - The user repository's NOT_FOUND result
 *
 * @file adapters.integration.test.ts
 * @description Tests for Infrastructure Adapters
 * @layer infrastructure
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { createSeedPrismaClient } from "./integration/helpers/seedPrismaClient.js";

/**
 * Fixture channel. The subject is the repository pattern; this client reads the publish logs and
 * backs the user repository.
 */
const prisma = createSeedPrismaClient();

const userRepository = new PrismaAdminUserRepository(prisma);

describe("Infrastructure Adapters", () => {
  after(async () => {
    // Disconnect Prisma.
    await prisma.$disconnect();
  });

  describe("Repository Pattern", () => {
    it("should respect limit parameter", async () => {
      const logs1 = await prisma.publishLog.findMany({ take: 1 });
      const logs2 = await prisma.publishLog.findMany({ take: 10 });

      assert.ok(Array.isArray(logs1), "First query should return array");
      assert.ok(Array.isArray(logs2), "Second query should return array");
      assert.ok(logs1.length <= 1, "Should respect take=1");
      assert.ok(logs2.length <= 10, "Should respect take=10");
    });

    it("should use UserRepository for user lookups", async () => {
      const result = await userRepository.findById("non-existent-id");

      assert.ok(!result.ok, "Should return failure for non-existent user");
      assert.strictEqual(result.error, "NOT_FOUND");
    });
  });
});
