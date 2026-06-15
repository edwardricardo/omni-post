/**
 * Adapters Integration Tests
 *
 * Tests infrastructure adapters including:
 * - Queue adapter health and functionality
 * - Repository pattern database operations
 * - Adapter integration with services
 *
 * @file adapters.test.ts
 * @description Tests for Infrastructure Adapters
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { QueuePort } from "@ports/core";
import type { Redis } from "ioredis";
import { prisma } from "@infra/prisma";
import { createRedisConnection } from "../src/lib/redis.js";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";

const userRepository = new PrismaAdminUserRepository(prisma);

describe("Infrastructure Adapters", () => {
  let queueAdapter: QueuePort | undefined;
  let queueConnection: Redis | undefined;

  before(async () => {
    // Initialize queue adapter with test configuration. The adapter no longer
    // self-constructs a connection (composition-root-owned); the test owns the
    // socket and injects it, mirroring production wiring.
    try {
      const { createBullMQQueueAdapter } = await import("@adapters/queue-bullmq");
      queueConnection = createRedisConnection();
      queueAdapter = createBullMQQueueAdapter({
        queueName: "publish",
        connection: queueConnection,
      });
    } catch (error) {
      console.warn("Queue adapter not available:", error);
    }
  });

  after(async () => {
    // Disconnect Prisma. Queue connections are left for --test-force-exit
    // to close cleanly, avoiding IPC serialization errors from ioredis quit().
    await prisma.$disconnect();
  });

  describe("Queue Adapter", () => {
    it("should check queue adapter availability", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }
      assert.ok(queueAdapter !== undefined, "Queue adapter should be initialized");
    });

    it("should pass health check", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      const health = await queueAdapter.health();
      assert.ok(health.ok, `Queue health check failed: ${health.ok ? "ok" : health.error}`);
    });

    it("should return health status object", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      const health = await queueAdapter.health();
      assert.ok(health !== undefined, "Health check should return a result");
      assert.ok(typeof health.ok === "boolean", "Health check should have ok boolean");
    });

    it("should handle health check gracefully", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      const health = await queueAdapter.health();

      if (!health.ok) {
        assert.ok(health.error, "Failed health check should include error message");
        assert.ok(typeof health.error === "string", "Error should be a string");
      } else {
        assert.strictEqual(health.ok, true, "Successful health check should have ok=true");
      }
    });
  });

  describe("Repository Pattern", () => {
    it("should query publish logs via Prisma", async () => {
      const logs = await prisma.publishLog.findMany({ take: 5 });

      assert.ok(Array.isArray(logs), "Should return an array");
      assert.ok(logs.length >= 0, "Should return zero or more logs");
    });

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

    it("should handle repository Result pattern", async () => {
      const result = await userRepository.findById("test-id");

      // Result should have either ok=true with value or ok=false with error
      if (result.ok) {
        assert.ok(result.value !== undefined, "Success should have value");
      } else {
        assert.ok(result.error, "Failure should have error message");
      }
    });
  });

  describe("Adapter Integration", () => {
    it("should check adapter availability", (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }
      assert.ok(queueAdapter !== undefined, "Queue adapter should be initialized");
    });

    it("should have required methods on queue adapter", (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      assert.ok(typeof queueAdapter.health === "function", "Queue should have health method");
    });

    it("should have user repository available", () => {
      assert.ok(userRepository !== undefined, "User repository should be available");
      assert.ok(typeof userRepository.findById === "function", "Should have findById method");
      assert.ok(
        typeof userRepository.findActiveUser === "function",
        "Should have findActiveUser method"
      );
    });

    it("should handle concurrent operations", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      const [health, logs, user] = await Promise.all([
        queueAdapter.health(),
        prisma.publishLog.findMany({ take: 5 }),
        userRepository.findById("test-id"),
      ]);

      assert.ok(health !== undefined, "Queue health should complete");
      assert.ok(Array.isArray(logs), "Repository query should complete");
      assert.ok(user !== undefined, "User repository should complete");
    });
  });

  describe("Result Pattern Compliance", () => {
    it("should follow Result pattern for queue health", async (t) => {
      if (!queueAdapter) {
        t.skip("Queue adapter not available");
        return;
      }

      const health = await queueAdapter.health();

      // Result should have either ok=true with value or ok=false with error
      if (health.ok) {
        assert.strictEqual(health.error, undefined, "Success should not have error");
      } else {
        assert.ok(health.error, "Failure should have error message");
        assert.strictEqual((health as any).value, undefined, "Failure should not have value");
      }
    });

    it("should follow Result pattern for repository queries", async () => {
      const result = await userRepository.findById("test-id");

      // Result should have either ok=true with value or ok=false with error
      if (result.ok) {
        assert.ok(result.value !== undefined, "Success should have value");
      } else {
        assert.ok(result.error, "Failure should have error message");
      }
    });
  });
});
