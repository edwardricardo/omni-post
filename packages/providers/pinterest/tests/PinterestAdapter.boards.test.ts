/**
 * @file PinterestAdapter.boards.test.ts
 * @description Unit tests for Pinterest board creation, board sections,
 *              and enhanced pin-level analytics via getPinAnalytics().
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { PinterestAdapter, type PinterestApiClientFactory } from "../src/PinterestAdapter.js";
import type { PinterestApiClient, PinterestCredentials } from "../src/apiClient.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    createBoard: vi.fn(async () => ({
      id: "board-123",
      name: "Test Board",
      description: "A test board",
      privacy: "PUBLIC" as const,
      owner: { username: "testuser" },
    })),
    createBoardSection: vi.fn(async () => ({
      id: "section-456",
      name: "Test Section",
    })),
    getUserAccount: vi.fn(async () => ({
      username: "testuser",
      account_type: "BUSINESS" as const,
      profile_image: "https://example.com/pic.jpg",
      pin_count: 42,
      board_count: 5,
    })),
    getPinAnalytics: vi.fn(async () => ({
      all: {
        lifetime_metrics: {
          IMPRESSION: 1500,
          SAVE: 30,
          PIN_CLICK: 120,
          OUTBOUND_CLICK: 45,
        },
      },
    })),
    createPin: vi.fn(async () => ({
      id: "pin-789",
      title: "Test Pin",
      description: "desc",
      link: "",
      board_id: "board-123",
      created_at: "2026-03-10T00:00:00Z",
      media: { media_type: "image" as const },
    })),
    getPin: vi.fn(async () => ({})),
    getBoards: vi.fn(async () => ({ items: [], bookmark: undefined })),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(),
    forceCircuitBreakerOpen: vi.fn(() => true),
    forceCircuitBreakerClose: vi.fn(() => true),
  };
}

const VALID_CREDS: PinterestCredentials = {
  accessToken: "tok",
  refreshToken: "ref",
  boardId: "b-1",
};

function makeAdapter(client: ReturnType<typeof makeMockApiClient>): PinterestAdapter {
  const factory: PinterestApiClientFactory = () => client as unknown as PinterestApiClient;
  return new PinterestAdapter({ apiClientFactory: factory });
}

// ============================================================================
// 1. Board Creation Tests (mock-only, exercise mock client directly)
// ============================================================================

describe("PinterestApiClient - Board Creation", { concurrency: 1 }, () => {
  it("creates a board with name and description", async () => {
    const mockClient = makeMockApiClient();

    const result = await mockClient.createBoard({
      name: "My Board",
      description: "Board description",
      privacy: "PUBLIC",
    });

    assert.strictEqual(result.id, "board-123");
    assert.strictEqual(result.name, "Test Board");
    assert.strictEqual(mockClient.createBoard.mock.calls.length, 1);
  });

  it("creates a board with privacy setting", async () => {
    const mockClient = makeMockApiClient();

    await mockClient.createBoard({
      name: "Secret Board",
      privacy: "SECRET",
    });

    const call = mockClient.createBoard.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0].privacy, "SECRET");
  });
});

// ============================================================================
// 2. Board Section Tests
// ============================================================================

describe("PinterestApiClient - Board Sections", { concurrency: 1 }, () => {
  it("creates a section in a board", async () => {
    const mockClient = makeMockApiClient();

    const result = await mockClient.createBoardSection("board-123", "Summer Pins");

    assert.strictEqual(result.id, "section-456");
    assert.strictEqual(result.name, "Test Section");
    assert.strictEqual(mockClient.createBoardSection.mock.calls.length, 1);

    const call = mockClient.createBoardSection.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0], "board-123");
    assert.strictEqual(call[1], "Summer Pins");
  });
});

// ============================================================================
// 3. Enhanced Analytics Tests
// ============================================================================

describe("PinterestAdapter - Enhanced Analytics", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pin-level metrics when providerPostId is provided", async () => {
    const mockClient = makeMockApiClient();
    const adapter = makeAdapter(mockClient);

    const result = await adapter.fetchAnalytics(
      {
        channelId: "ch-001",
        providerPostId: "pin-789",
      },
      VALID_CREDS
    );

    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    const metrics = data.metrics as Record<string, unknown>;

    assert.strictEqual(metrics.pinCount, 42);
    assert.strictEqual(metrics.boardCount, 5);

    const pin = metrics.pin as Record<string, number>;
    assert.ok(pin, "Pin metrics should be present");
    assert.strictEqual(pin.impressions, 1500);
    assert.strictEqual(pin.saves, 30);
    assert.strictEqual(pin.pinClicks, 120);
    assert.strictEqual(pin.outboundClicks, 45);

    assert.strictEqual(mockClient.getPinAnalytics.mock.calls.length, 1);
  });

  it("returns account-only metrics when no providerPostId", async () => {
    const mockClient = makeMockApiClient();
    const adapter = makeAdapter(mockClient);

    const result = await adapter.fetchAnalytics({ channelId: "ch-001" }, VALID_CREDS);

    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    const metrics = data.metrics as Record<string, unknown>;

    assert.strictEqual(metrics.pinCount, 42);
    assert.strictEqual(metrics.boardCount, 5);
    assert.strictEqual(metrics.pin, undefined);

    assert.strictEqual(mockClient.getPinAnalytics.mock.calls.length, 0);
  });

  it("returns account metrics even if pin analytics fails", async () => {
    const mockClient = makeMockApiClient();
    mockClient.getPinAnalytics = vi.fn(async () => {
      throw new Error("Pin analytics unavailable");
    });
    const adapter = makeAdapter(mockClient);

    const result = await adapter.fetchAnalytics(
      {
        channelId: "ch-001",
        providerPostId: "old-pin-999",
      },
      VALID_CREDS
    );

    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    const metrics = data.metrics as Record<string, unknown>;

    assert.strictEqual(metrics.pinCount, 42);
    assert.strictEqual(metrics.pin, undefined);
  });

  it("uses custom date range when provided", async () => {
    const mockClient = makeMockApiClient();
    const adapter = makeAdapter(mockClient);

    const since = new Date("2026-01-01");
    const until = new Date("2026-02-01");

    const result = await adapter.fetchAnalytics(
      {
        channelId: "ch-001",
        since,
        until,
        providerPostId: "pin-789",
      },
      VALID_CREDS
    );

    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    const dateRange = data.dateRange as Record<string, string>;

    assert.strictEqual(dateRange.startDate, "2026-01-01");
    assert.strictEqual(dateRange.endDate, "2026-02-01");

    const call = mockClient.getPinAnalytics.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[1], "2026-01-01");
    assert.strictEqual(call[2], "2026-02-01");
  });
});
