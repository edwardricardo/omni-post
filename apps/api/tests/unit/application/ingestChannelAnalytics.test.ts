/**
 * @file ingestChannelAnalytics.test.ts
 * @description Unit tests for IngestChannelAnalyticsUseCase
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  IngestChannelAnalyticsUseCase,
  INGEST_ERRORS,
} from "@core/analytics/IngestChannelAnalyticsUseCase.js";
import { ok, err } from "@shared/types";

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: { value: "550e8400-e29b-41d4-a716-446655440001" },
    provider: { toString: () => "INSTAGRAM" },
    handle: "@test",
    credentials: { accessToken: "tok-123" },
    projectId: { value: "proj-001" },
    status: "CONNECTED",
    ...overrides,
  };
}

function makeMockChannelRepo(channel: unknown = makeChannel()) {
  return {
    findById: vi.fn().mockResolvedValue(ok(channel)),
    findByProjectId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    hardDelete: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockAnalyticsWriteRepo() {
  return {
    upsertDailySummary: vi.fn().mockResolvedValue(ok(undefined)),
    upsertDailySummaries: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockAdapter(
  analyticsData: unknown = {
    metrics: [
      { date: "2026-03-01", views: 100, likes: 10, comments: 5, shares: 2 },
      { date: "2026-03-02", views: 200, likes: 20, comments: 10, shares: 4 },
    ],
  }
) {
  return {
    id: "instagram",
    limits: { maxTextLength: 2200 },
    capabilities: {
      publish: true,
      schedule: true,
      analytics: true,
      comments: true,
      replies: true,
      threading: false,
    },
    validateCredentials: vi.fn(),
    render: vi.fn(),
    publish: vi.fn(),
    fetchAnalytics: vi.fn().mockResolvedValue(ok(analyticsData)),
  };
}

describe("IngestChannelAnalyticsUseCase", () => {
  let channelRepo: ReturnType<typeof makeMockChannelRepo>;
  let analyticsWriteRepo: ReturnType<typeof makeMockAnalyticsWriteRepo>;
  let adapter: ReturnType<typeof makeMockAdapter>;
  let useCase: IngestChannelAnalyticsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    channelRepo = makeMockChannelRepo();
    analyticsWriteRepo = makeMockAnalyticsWriteRepo();
    adapter = makeMockAdapter();
    useCase = new IngestChannelAnalyticsUseCase(
      channelRepo as never,
      analyticsWriteRepo,
      (provider: string) => (provider === "instagram" ? (adapter as never) : undefined)
    );
  });

  it("fetches and stores analytics for active channel", async () => {
    const result = await useCase.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
    });

    assert.ok(result.ok, "Should succeed");
    assert.strictEqual(result.value.ingested, 2);
    assert.strictEqual(result.value.channelId, "550e8400-e29b-41d4-a716-446655440001");
    expect(adapter.fetchAnalytics).toHaveBeenCalledOnce();
    expect(analyticsWriteRepo.upsertDailySummaries).toHaveBeenCalledOnce();
  });

  it("returns CHANNEL_NOT_FOUND when channel does not exist", async () => {
    channelRepo.findById.mockResolvedValue(
      err({ name: "EntityNotFoundError", message: "Not found" })
    );

    const result = await useCase.execute({
      channelId: "nonexistent",
      accountId: "account-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, INGEST_ERRORS.CHANNEL_NOT_FOUND);
  });

  it("returns AUTH_ERROR on provider 401", async () => {
    adapter.fetchAnalytics.mockResolvedValue(err("AUTH"));

    const result = await useCase.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, INGEST_ERRORS.AUTH_ERROR);
  });

  it("returns PROVIDER_ERROR on network failure", async () => {
    adapter.fetchAnalytics.mockResolvedValue(err("NETWORK"));

    const result = await useCase.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, INGEST_ERRORS.PROVIDER_ERROR);
  });

  it("returns ANALYTICS_NOT_SUPPORTED when provider lacks fetchAnalytics", async () => {
    const useCaseNoAnalytics = new IngestChannelAnalyticsUseCase(
      channelRepo as never,
      analyticsWriteRepo,
      () => ({ id: "telegram", fetchAnalytics: undefined }) as never
    );

    const result = await useCaseNoAnalytics.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, INGEST_ERRORS.ANALYTICS_NOT_SUPPORTED);
  });

  it("returns ingested=0 when provider returns empty metrics", async () => {
    adapter.fetchAnalytics.mockResolvedValue(ok({ metrics: [] }));

    const result = await useCase.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.ingested, 0);
    expect(analyticsWriteRepo.upsertDailySummaries).not.toHaveBeenCalled();
  });

  it("uses custom since date when provided", async () => {
    const since = new Date("2026-01-01");
    await useCase.execute({
      channelId: "550e8400-e29b-41d4-a716-446655440001",
      accountId: "account-001",
      since,
    });

    const call = adapter.fetchAnalytics.mock.calls[0]?.[0] as { since?: Date };
    assert.ok(call);
    assert.strictEqual(call.since?.toISOString(), since.toISOString());
  });
});
