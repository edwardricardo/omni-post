/**
 * @file webhookHandler.processing.test.ts
 * @description Tests for WebhookHandler duplicate detection, signature verification,
 *              provider routing, and edge cases.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";
import { createSignature, createTestSubscriptionData } from "./webhookHandler.test-helpers.js";

// ---------------------------------------------------------------------------
// Mock @infra/prisma with all models needed by webhook processors
// ---------------------------------------------------------------------------
const { mockPrisma, stores } = createMockPrismaModule();

// Additional stores for models used by webhook processors
const channelStore = createStore<Record<string, unknown>>();
const postStore = createStore<Record<string, unknown>>();
const publishLogStore = createStore<Record<string, unknown>>();
const analyticsStore = createStore<Record<string, unknown>>();
const instagramAnalyticsStore = createStore<Record<string, unknown>>();

// Override webhookEvent.findUnique to handle compound key provider_eventId
const webhookEventMock = mockPrisma.prisma.webhookEvent;
const originalFindUnique = webhookEventMock.findUnique;
webhookEventMock.findUnique = vi.fn(async (args: Record<string, unknown>) => {
  const where = args.where as Record<string, unknown>;
  // Expand compound key provider_eventId into separate fields
  if (where && typeof where.provider_eventId === "object" && where.provider_eventId !== null) {
    const compound = where.provider_eventId as Record<string, unknown>;
    const expandedWhere = { ...where, ...compound };
    delete expandedWhere.provider_eventId;
    return originalFindUnique({ ...args, where: expandedWhere });
  }
  return originalFindUnique(args);
});

const extendedPrisma = {
  ...mockPrisma.prisma,
  channel: buildModelMock(channelStore),
  post: buildModelMock(postStore),
  publishLog: buildModelMock(publishLogStore),
  analytics: buildModelMock(analyticsStore),
  instagramAnalytics: buildModelMock(instagramAnalyticsStore),
};

vi.mock("@infra/prisma", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, prisma: extendedPrisma };
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
  channelStore.clear();
  postStore.clear();
  publishLogStore.clear();
  analyticsStore.clear();
  instagramAnalyticsStore.clear();
}

// ---------------------------------------------------------------------------
// Duplicate Event Detection
// ---------------------------------------------------------------------------
describe("WebhookHandler - Duplicate Event Detection", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should process event on first occurrence", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [
        {
          id: "unique-event-001",
          changes: [
            {
              field: "media",
              value: {
                id: "media-123",
                media_type: "IMAGE",
                caption: "Test post",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(true);
  });

  it("should return existing data on duplicate event", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    // Pre-seed a completed webhook event with eventId matching the payload
    stores.webhookEvent.add({
      id: randomUUID(),
      provider: "INSTAGRAM",
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: "duplicate-event-123",
      signature: "test-signature",
      payload: { test: "data" },
      headers: {},
      status: "COMPLETED",
      verified: true,
      processed: true,
      normalizedData: { message: "already processed" },
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Record<string, unknown>);

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [{ id: "duplicate-event-123" }],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(true);
    expect(result.normalizedData).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------
describe("WebhookHandler - Signature Verification", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should accept valid Instagram signature", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [
        {
          id: "valid-signature-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-456",
                media_type: "IMAGE",
                caption: "Valid signature",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(true);
  });

  it("should reject invalid signature", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [{ id: "invalid-signature-test" }],
    });

    const invalidSignature = "sha256=invalid-signature-hash";
    const headers = { "x-hub-signature-256": invalidSignature };

    const result = await handler.handleWebhook("INSTAGRAM", invalidSignature, payload, headers);

    expect(result.success).toBe(false);
    expect(result.error?.includes("signature verification failed")).toBeTruthy();
  });

  it("should reject request with missing signature", async () => {
    seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [{ id: "missing-signature-test" }],
    });

    const result = await handler.handleWebhook("INSTAGRAM", "", payload, {});

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider Routing
// ---------------------------------------------------------------------------
describe("WebhookHandler - Provider Routing", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should route Instagram webhook to Instagram processor", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [
        {
          id: "instagram-routing-test",
          changes: [
            {
              field: "media",
              value: {
                id: "media-789",
                media_type: "IMAGE",
                caption: "Routing test",
                timestamp: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(true);
  });

  it("should route Facebook webhook to Instagram processor (shared)", async () => {
    const { subscription } = seedSubscription("FACEBOOK");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      entry: [
        {
          id: "facebook-routing-test",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-123",
                text: "Great post!",
                created_time: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("FACEBOOK", signature, payload, headers);

    expect(result.success).toBe(true);
  });

  it("should route X webhook to X processor", async () => {
    const { subscription } = seedSubscription("X");

    const handler = new UniversalWebhookHandler(extendedPrisma as never);
    const payload = JSON.stringify({
      tweet_create_events: [
        {
          id_str: "x-routing-test",
          text: "Test tweet",
          user: {
            id_str: "user-123",
            screen_name: "testuser",
          },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.success).toBe(true);
  });
});
