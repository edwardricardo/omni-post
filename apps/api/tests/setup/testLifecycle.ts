/**
 * Test Lifecycle Manager
 * Manages all test resources with proper cleanup in LIFO order
 *
 * This module solves the root cause of test hangs: missing prisma.$disconnect()
 * and unclosed resources (Fastify, Redis, etc.)
 */
import { prisma } from "@infra/prisma";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

export class TestLifecycleManager {
  private cleanupStack: Array<() => Promise<void>> = [];
  private static instance: TestLifecycleManager | null = null;

  static getInstance(): TestLifecycleManager {
    if (!TestLifecycleManager.instance) {
      TestLifecycleManager.instance = new TestLifecycleManager();
    }
    return TestLifecycleManager.instance;
  }

  /**
   * Register cleanup function (LIFO - last registered, first executed)
   */
  registerCleanup(fn: () => Promise<void>): void {
    this.cleanupStack.push(fn);
  }

  /**
   * Register Fastify app for cleanup
   */
  registerFastify(app: FastifyInstance): void {
    this.registerCleanup(async () => {
      try {
        await app.close();
      } catch (err) {
        console.warn("Fastify close warning:", err);
      }
    });
  }

  /**
   * Register Redis client for cleanup
   */
  registerRedis(redis: Redis): void {
    this.registerCleanup(async () => {
      try {
        await redis.quit();
      } catch (err) {
        console.warn("Redis quit warning:", err);
      }
    });
  }

  /**
   * Execute all cleanup functions in LIFO order, then disconnect Prisma
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    // Execute cleanup stack in reverse order (LIFO)
    while (this.cleanupStack.length > 0) {
      const fn = this.cleanupStack.pop()!;
      try {
        await fn();
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // ALWAYS disconnect Prisma last
    try {
      await prisma.$disconnect();
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }

    // Reset instance for next test suite
    TestLifecycleManager.instance = null;

    if (errors.length > 0) {
      console.error(
        "Cleanup errors:",
        errors.map((e) => e.message)
      );
    }
  }
}

/**
 * Convenience function for simple tests
 * Use this in after() hooks when you only need Prisma cleanup
 */
export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.warn("Prisma disconnect warning:", err);
  }
}

/**
 * Create a fresh lifecycle manager for a test suite
 * Returns both the manager and a cleanup function for after() hooks
 */
export function createTestLifecycle(): {
  lifecycle: TestLifecycleManager;
  cleanup: () => Promise<void>;
} {
  const lifecycle = TestLifecycleManager.getInstance();
  return {
    lifecycle,
    cleanup: async () => {
      await lifecycle.cleanup();
    },
  };
}
