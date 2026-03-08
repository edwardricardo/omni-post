/**
 * STANDARD TEST FILE TEMPLATE
 *
 * Copy this structure for all new tests.
 * This template demonstrates the correct patterns for:
 * - Test lifecycle management
 * - Proper cleanup (CRITICAL: prevents test hangs)
 * - Unique test data generation
 * - Result type assertions
 *
 * Usage: Copy this file and rename for your test
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { TestDataFactory } from "./testDataFactory.js";
import { disconnectPrisma } from "./testLifecycle.js";

describe("Feature Name", () => {
  // ============================================
  // SETUP - Create factory for unique test data
  // ============================================
  const testData = new TestDataFactory();

  // ============================================
  // LIFECYCLE HOOKS (REQUIRED)
  // ============================================

  before(async () => {
    // One-time setup for this describe block
    // Example: Verify database connection
    await prisma.$connect();
  });

  after(async () => {
    // CRITICAL: Cleanup in this order
    // 1. Clean up test data created during tests
    await testData.cleanup();

    // 2. ALWAYS disconnect Prisma - prevents connection pool exhaustion
    await disconnectPrisma();
  });

  beforeEach(async () => {
    // Optional: Reset state before each test
    // Note: Usually not needed if using unique data per test
  });

  // ============================================
  // TESTS
  // ============================================

  describe("Specific Feature", () => {
    it("should perform expected behavior", async () => {
      // ARRANGE - Set up test data
      const account = await testData.createAccount();
      const project = await testData.createProject(account.id);

      // ACT - Execute the operation under test
      const result = await prisma.project.findUnique({
        where: { id: project.id },
      });

      // ASSERT - Verify the result
      assert.ok(result, "Project should exist");
      assert.strictEqual(result.accountId, account.id);
    });

    it("should handle error cases", async () => {
      // ACT - Try invalid operation
      const result = await prisma.project.findUnique({
        where: { id: "non-existent-id" },
      });

      // ASSERT - Verify null/error handling
      assert.strictEqual(result, null, "Should return null for non-existent ID");
    });
  });

  describe("Result Type Handling", () => {
    it("should properly narrow Result types", async () => {
      // Example for services that return Result<T, E>
      // const result = await someService.operation(input);

      // Pattern for success assertion:
      // assert.ok(result.ok, `Operation should succeed: ${result.ok ? '' : result.error}`);
      // if (result.ok) {
      //   assert.strictEqual(result.value.property, expectedValue);
      // }

      // Pattern for failure assertion:
      // assert.ok(!result.ok, "Operation should fail");
      // if (!result.ok) {
      //   assert.match(result.error, /expected error pattern/);
      // }

      assert.ok(true, "Template placeholder");
    });
  });
});

/*
 * QUICK REFERENCE: Cleanup Patterns
 *
 * Pattern A: Simple Database Test (most common)
 * ---------------------------------------------
 * after(async () => {
 *   await testData.cleanup();
 *   await disconnectPrisma();
 * });
 *
 * Pattern B: Test with Fastify App
 * --------------------------------
 * after(async () => {
 *   await testData.cleanup();
 *   await app.close();
 *   await disconnectPrisma();
 * });
 *
 * Pattern C: Test with Redis
 * --------------------------
 * after(async () => {
 *   await testData.cleanup();
 *   await redis.quit();
 *   await disconnectPrisma();
 * });
 *
 * Pattern D: Complex Integration Test
 * -----------------------------------
 * after(async () => {
 *   await testData.cleanup();
 *   await cacheManager.close();
 *   await app.close();
 *   await redis.quit();
 *   await disconnectPrisma();
 * });
 *
 * IMPORTANT: Always call disconnectPrisma() LAST in after() hooks!
 */
