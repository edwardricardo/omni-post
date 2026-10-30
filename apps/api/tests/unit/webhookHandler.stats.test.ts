/**
 * @file webhookHandler.stats.test.ts
 * @description Tests that UniversalWebhookHandler.handleWebhook returns an unsuccessful result
 *              for an empty payload and for one of unexpected structure, with mocked prisma.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import type { PrismaClient } from "@infra/prisma";
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

// Injected into the handler via the constructor (DI) — no module mock.
const mockDb = extendedPrisma as unknown as PrismaClient;

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
// Edge Cases
// ---------------------------------------------------------------------------
describe("WebhookHandler - Edge Cases", () => {
  beforeEach(() => {
    clearAllStores();
  });

  it("should handle empty payload object", async () => {
    const { subscription } = seedSubscription("INSTAGRAM");

    const handler = new UniversalWebhookHandler(mockDb);
    const payload = JSON.stringify({});

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-hub-signature-256": signature };

    const result = await handler.handleWebhook("INSTAGRAM", signature, payload, headers);

    expect(result.success).toBe(false);
  });

  it("should handle payload with unexpected structure", async () => {
    const { subscription } = seedSubscription("X");

    const handler = new UniversalWebhookHandler(mockDb);
    const payload = JSON.stringify({ unexpected: "structure" });

    const signature = createSignature(payload, subscription.secretKey);
    const headers = { "x-signature": signature };

    const result = await handler.handleWebhook("X", signature, payload, headers);

    expect(result.success).toBe(false);
  });
});
