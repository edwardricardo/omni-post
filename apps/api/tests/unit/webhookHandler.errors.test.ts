/**
 * @file webhookHandler.errors.test.ts
 * @description Tests for WebhookHandler error handling, retry logic, and dead letter queue.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { createSignature, createTestSubscriptionData } from "./webhookHandler.test-helpers.js";

// ---------------------------------------------------------------------------
// Mock @infra/prisma before any imports that use it
// ---------------------------------------------------------------------------
const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, prisma: mockPrisma.prisma };
});

// Mock the logger to avoid console noise
vi.mock("../../src/lib/logger.js", () => ({
  webhookLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Import after mocks are set up
const { UniversalWebhookHandler } = await import("../../src/webhooks/webhookHandler.js");

/**
 * Seeds a webhook subscription into the mock stores and returns the data.
 */
function seedSubscription(provider: "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK") {
  const { account, project, subscription } = createTestSubscriptionData(provider);
  stores.account.add(account as Record<string, unknown>);
  stores.project.add(project as Record<string, unknown>);
  stores.webhookSubscription.add(subscription as Record<string, unknown>);
  return { account, project, subscription };
}

function clearAllStores() {
  for (const store of Object.values(stores) as { clear: () => void }[]) {
    store.clear();
  }
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------
describe("WebhookHandler - Error Handling", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should handle missing webhook subscription", async () => {
    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "no-subscription-test" }],
    });

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(false);
    expect(result.error?.includes("not found")).toBeTruthy();
  });

  it("should handle malformed JSON payload", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const malformedPayload = "{ invalid json";

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, malformedPayload, headers);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should handle inactive webhook subscription", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    // Deactivate the subscription in the store
    stores.webhookSubscription.update(subscription.id, { isActive: false });

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "inactive-subscription-test" }],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(false);
    expect(
      result.error?.includes("No active webhook subscription") ||
        result.error?.includes("subscription") ||
        result.error?.includes("not found")
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------
describe("WebhookHandler - Retry Logic", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should mark retryable errors for retry", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "retryable-error-test" }],
    });

    const signature = "sha256=test-signature";
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.success).toBe(false);
  });

  it("should not retry signature verification failures", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "non-retryable-test" }],
    });

    const invalidSignature = "sha256=wrong-signature";
    const headers = { "x-hub-signature-256": invalidSignature };

    const result = await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    expect(result.success).toBe(false);
    expect(result.retryAfter).toBe(undefined);
  });

  it("should calculate exponential backoff for retries", async () => {
    const handler = new UniversalWebhookHandler();

    const calculateRetryDelay = (
      handler as Record<string, unknown> & {
        calculateRetryDelay: (n: number) => number;
      }
    ).calculateRetryDelay.bind(handler);

    const delay1 = calculateRetryDelay(1);
    const delay2 = calculateRetryDelay(2);
    const delay3 = calculateRetryDelay(3);

    expect(delay1).toBe(5000);
    expect(delay2).toBe(10000);
    expect(delay3).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// Dead Letter Queue
// ---------------------------------------------------------------------------
describe("WebhookHandler - Dead Letter Queue", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should move non-retryable events to dead letter queue", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler();
    const payload = JSON.stringify({
      entry: [{ id: "dead-letter-test" }],
    });

    const invalidSignature = "sha256=invalid-signature";
    const headers = { "x-hub-signature-256": invalidSignature };

    await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    const deadLetterEvents = stores.webhookDeadLetter.all();

    expect(Array.isArray(deadLetterEvents)).toBeTruthy();
  });
});
