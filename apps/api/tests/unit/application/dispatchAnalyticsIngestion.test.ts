/**
 * @file dispatchAnalyticsIngestion.test.ts
 * @description Unit tests for DispatchAnalyticsIngestionUseCase
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DispatchAnalyticsIngestionUseCase } from "@core/analytics/DispatchAnalyticsIngestionUseCase.js";
import { ok, err } from "@shared/types";

function makeMockChannelQuery(
  channels: Array<{ id: string; projectId: string; provider: string; accountId: string }> = [
    { id: "ch-1", projectId: "proj-1", provider: "INSTAGRAM", accountId: "acc-1" },
    { id: "ch-2", projectId: "proj-1", provider: "X", accountId: "acc-1" },
    { id: "ch-3", projectId: "proj-2", provider: "FACEBOOK", accountId: "acc-2" },
  ]
) {
  return {
    findActiveChannels: vi.fn().mockResolvedValue(channels),
  };
}

function makeMockQueue() {
  return {
    enqueue: vi.fn().mockResolvedValue(ok("job-id-123")),
    health: vi
      .fn()
      .mockResolvedValue(ok({ connected: true, waiting: 0, active: 0, completed: 0, failed: 0 })),
    remove: vi.fn().mockResolvedValue(ok(true)),
  };
}

describe("DispatchAnalyticsIngestionUseCase", () => {
  let channelQuery: ReturnType<typeof makeMockChannelQuery>;
  let queue: ReturnType<typeof makeMockQueue>;
  let useCase: DispatchAnalyticsIngestionUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    channelQuery = makeMockChannelQuery();
    queue = makeMockQueue();
    useCase = new DispatchAnalyticsIngestionUseCase(channelQuery, queue, "analytics-aggregation");
  });

  it("dispatches one job per active channel", async () => {
    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 3);
    assert.strictEqual(result.value.skipped, 0);
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
  });

  it("returns count of dispatched jobs", async () => {
    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 3);
  });

  it("filters by accountId when provided", async () => {
    await useCase.execute({ accountId: "acc-1" });

    expect(channelQuery.findActiveChannels).toHaveBeenCalledWith("acc-1");
  });

  it("counts skipped when enqueue fails", async () => {
    queue.enqueue
      .mockResolvedValueOnce(ok("job-1"))
      .mockResolvedValueOnce(err("CONNECTION_ERROR"))
      .mockResolvedValueOnce(ok("job-3"));

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 2);
    assert.strictEqual(result.value.skipped, 1);
  });

  it("dispatches zero jobs when no channels exist", async () => {
    channelQuery.findActiveChannels.mockResolvedValue([]);

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 0);
    assert.strictEqual(result.value.skipped, 0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("includes channelId and accountId in job payload", async () => {
    channelQuery = makeMockChannelQuery([
      { id: "ch-42", projectId: "proj-1", provider: "TIKTOK", accountId: "acc-99" },
    ]);
    useCase = new DispatchAnalyticsIngestionUseCase(channelQuery, queue, "analytics-aggregation");

    await useCase.execute({});

    const call = queue.enqueue.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    assert.ok(call);
    assert.strictEqual(call.payload.channelId, "ch-42");
    assert.strictEqual(call.payload.accountId, "acc-99");
  });

  it("uses deterministic dedupeKey per channel", async () => {
    channelQuery = makeMockChannelQuery([
      { id: "ch-1", projectId: "proj-1", provider: "X", accountId: "acc-1" },
    ]);
    useCase = new DispatchAnalyticsIngestionUseCase(channelQuery, queue, "analytics-aggregation");

    await useCase.execute({});

    const call = queue.enqueue.mock.calls[0]?.[0] as { dedupeKey: string };
    assert.ok(call);
    assert.ok(call.dedupeKey.startsWith("analytics-ingest-ch-1-"));
  });
});
