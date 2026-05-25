/**
 * @file DispatchMentionSearchUseCase.test.ts
 * @description Unit tests for DispatchMentionSearchUseCase
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DispatchMentionSearchUseCase } from "@core/application/listening/DispatchMentionSearchUseCase.js";
import type { TrackedTermForSearch } from "@core/domain/repositories/TrackedTermQuery.js";
import { ok, err } from "@shared/types";

function makeMockTermQuery(
  terms: TrackedTermForSearch[] = [
    { id: "t-1", accountId: "acc-1", projectId: "proj-1", term: "acme", kind: "BRAND" },
    { id: "t-2", accountId: "acc-1", projectId: "proj-1", term: "rival", kind: "MARKET" },
  ]
) {
  return {
    findActiveTerms: vi.fn().mockResolvedValue(terms),
  };
}

function makeMockChannelQuery(
  channels: Array<{ id: string; projectId: string; provider: string; accountId: string }> = [
    { id: "ch-x", projectId: "proj-1", provider: "X", accountId: "acc-1" },
    { id: "ch-bsky", projectId: "proj-1", provider: "BLUESKY", accountId: "acc-1" },
    { id: "ch-ig", projectId: "proj-1", provider: "INSTAGRAM", accountId: "acc-1" },
  ]
) {
  return {
    findActiveChannels: vi.fn().mockResolvedValue(channels),
  };
}

function makeMockQueue() {
  return {
    enqueue: vi.fn().mockResolvedValue(ok("job-id")),
    health: vi
      .fn()
      .mockResolvedValue(ok({ connected: true, waiting: 0, active: 0, completed: 0, failed: 0 })),
    remove: vi.fn().mockResolvedValue(ok(true)),
  };
}

const SEARCH_CAPABLE = ["x", "bluesky"] as const;

describe("DispatchMentionSearchUseCase", () => {
  let termQuery: ReturnType<typeof makeMockTermQuery>;
  let channelQuery: ReturnType<typeof makeMockChannelQuery>;
  let queue: ReturnType<typeof makeMockQueue>;
  let useCase: DispatchMentionSearchUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    termQuery = makeMockTermQuery();
    channelQuery = makeMockChannelQuery();
    queue = makeMockQueue();
    useCase = new DispatchMentionSearchUseCase(termQuery, channelQuery, queue, SEARCH_CAPABLE);
  });

  it("dispatches one job per search-capable channel whose project has terms", async () => {
    const result = await useCase.execute({});

    assert.ok(result.ok);
    // X + Bluesky are capable; Instagram is not → 2 jobs.
    assert.strictEqual(result.value.dispatched, 2);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch to providers that cannot search mentions", async () => {
    await useCase.execute({});

    const providers = queue.enqueue.mock.calls.map(
      (c) => (c[0] as { payload: { provider: string } }).payload.provider
    );
    assert.deepStrictEqual(providers.sort(), ["bluesky", "x"]);
    assert.ok(!providers.includes("instagram"));
  });

  it("dispatches zero jobs when no active terms exist", async () => {
    termQuery.findActiveTerms.mockResolvedValue([]);

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 0);
    expect(channelQuery.findActiveChannels).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("carries the project's terms and channel context in the payload", async () => {
    await useCase.execute({});

    const call = queue.enqueue.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
      dedupeKey: string;
    };
    assert.ok(call);
    assert.strictEqual(call.payload.kind, "search");
    assert.strictEqual(call.payload.projectId, "proj-1");
    assert.deepStrictEqual(call.payload.terms, [
      { id: "t-1", term: "acme", kind: "BRAND" },
      { id: "t-2", term: "rival", kind: "MARKET" },
    ]);
    assert.ok(typeof call.payload.channelId === "string");
    assert.ok(call.dedupeKey.startsWith("mention-search-"));
  });

  it("produces a deterministic dedupeKey per channel and window", async () => {
    await useCase.execute({});
    const first = (queue.enqueue.mock.calls[0]?.[0] as { dedupeKey: string }).dedupeKey;

    vi.clearAllMocks();
    await useCase.execute({});
    const second = (queue.enqueue.mock.calls[0]?.[0] as { dedupeKey: string }).dedupeKey;

    assert.strictEqual(first, second);
  });

  it("counts skipped when enqueue fails", async () => {
    queue.enqueue.mockResolvedValueOnce(ok("job-1")).mockResolvedValueOnce(err("CONNECTION_ERROR"));

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 1);
    assert.strictEqual(result.value.skipped, 1);
  });

  it("filters by accountId when provided", async () => {
    await useCase.execute({ accountId: "acc-1" });

    expect(termQuery.findActiveTerms).toHaveBeenCalledWith("acc-1");
    expect(channelQuery.findActiveChannels).toHaveBeenCalledWith("acc-1");
  });

  it("runs inside the unit of work when provided", async () => {
    const executeInTransaction = vi.fn().mockImplementation(async (fn: () => Promise<void>) => {
      await fn();
    });
    const uow = { executeInTransaction };
    const withUow = new DispatchMentionSearchUseCase(
      termQuery,
      channelQuery,
      queue,
      SEARCH_CAPABLE,
      uow
    );

    const result = await withUow.execute({});

    assert.ok(result.ok);
    expect(executeInTransaction).toHaveBeenCalledTimes(1);
  });
});
