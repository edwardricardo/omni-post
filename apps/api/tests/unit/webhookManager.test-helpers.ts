/**
 * @file webhookManager.test-helpers.ts
 * @description Shared test helpers for WebhookManager unit tests.
 *              Uses in-memory stores instead of real DB/Redis connections.
 * @layer infrastructure
 */

import { vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { WebhookManager } from "../../src/webhooks/webhookManager.js";

export interface WebhookManagerTestState {
  testAccountId: string;
  testAccount2Id: string;
  testProjectId: string;
  testProject2Id: string;
  webhookManager: WebhookManager;
}

export const state: WebhookManagerTestState = {
  testAccountId: "",
  testAccount2Id: "",
  testProjectId: "",
  testProject2Id: "",
  webhookManager: null as unknown as WebhookManager,
};

export async function setupWebhookManagerTestData(prisma: PrismaClient): Promise<void> {
  const { randomUUID } = await import("crypto");

  state.testAccountId = randomUUID();
  state.testAccount2Id = randomUUID();
  state.testProjectId = randomUUID();
  state.testProject2Id = randomUUID();

  // Create a mock Redis instance (matching the mock from the test files)
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    quit: vi.fn(async () => "OK"),
    disconnect: vi.fn(),
    status: "ready",
    on: vi.fn(),
    off: vi.fn(),
  };

  state.webhookManager = new WebhookManager(prisma, mockRedis as never);
}

export async function teardownWebhookManagerTestData(): Promise<void> {
  try {
    await state.webhookManager.shutdown();
  } catch (_err) {
    // Ignore shutdown errors in test teardown
  }
}
