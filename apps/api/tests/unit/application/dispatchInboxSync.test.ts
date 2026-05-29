/**
 * @file dispatchInboxSync.test.ts
 * @description Unit tests for DispatchInboxSyncUseCase
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { DispatchInboxSyncUseCase } from "@core/inbox/DispatchInboxSyncUseCase.js";
import { ok, err } from "@shared/types";

function makeMockChannelQuery(
  channels: Array<{ id: string; projectId: string; provider: string; accountId: string }> = [
    { id: "ch-1", projectId: "proj-1", provider: "INSTAGRAM", accountId: "acc-1" },
    { id: "ch-2", projectId: "proj-1", provider: "X", accountId: "acc-1" },
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

describe("DispatchInboxSyncUseCase", () => {
  let channelQuery: ReturnType<typeof makeMockChannelQuery>;
  let queue: ReturnType<typeof makeMockQueue>;
  let useCase: DispatchInboxSyncUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    channelQuery = makeMockChannelQuery();
    queue = makeMockQueue();
    useCase = new DispatchInboxSyncUseCase(channelQuery, queue, "inbox-sync");
  });

  it("dispatches job per channel", async () => {
    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 2);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it("skips channels without inbox capability when enqueue fails", async () => {
    queue.enqueue.mockResolvedValueOnce(ok("job-1")).mockResolvedValueOnce(err("CONNECTION_ERROR"));

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 1);
    assert.strictEqual(result.value.skipped, 1);
  });

  it("dispatches zero jobs when no channels exist", async () => {
    channelQuery.findActiveChannels.mockResolvedValue([]);

    const result = await useCase.execute({});

    assert.ok(result.ok);
    assert.strictEqual(result.value.dispatched, 0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("filters by accountId when provided", async () => {
    await useCase.execute({ accountId: "acc-1" });

    expect(channelQuery.findActiveChannels).toHaveBeenCalledWith("acc-1");
  });

  it("includes projectId in job payload", async () => {
    await useCase.execute({});

    const call = queue.enqueue.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    assert.ok(call);
    assert.strictEqual(call.payload.projectId, "proj-1");
  });
});
