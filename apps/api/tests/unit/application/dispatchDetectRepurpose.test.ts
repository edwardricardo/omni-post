/**
 * @file dispatchDetectRepurpose.test.ts
 * @description Unit tests for the repurpose-detection coordinator: one job
 *              per distinct account with active channels, date-bucketed
 *              dedupe key, enqueue-failure accounting, and the
 *              UnitOfWork-wrapped path.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";
import { DispatchDetectRepurposeUseCase } from "@core/application/ai/DispatchDetectRepurposeUseCase.js";

type Channel = Awaited<ReturnType<ChannelQueryForIngestion["findActiveChannels"]>>[number];

const ch = (id: string, accountId: string): Channel =>
  ({ id, accountId, projectId: `proj-${id}` }) as Channel;

function makeChannelQuery(channels: Channel[]): ChannelQueryForIngestion {
  return { findActiveChannels: vi.fn(async () => channels) } as unknown as ChannelQueryForIngestion;
}

function makeQueue(enqueue: QueuePort["enqueue"]): { queue: QueuePort; calls: unknown[] } {
  const calls: unknown[] = [];
  const queue = {
    enqueue: vi.fn(async (job: Parameters<QueuePort["enqueue"]>[0]) => {
      calls.push(job);
      return enqueue(job);
    }),
    health: vi.fn(),
    remove: vi.fn(),
    getJobStates: vi.fn(),
  } as unknown as QueuePort;
  return { queue, calls };
}

const okEnqueue: QueuePort["enqueue"] = async () =>
  ok("job-1") as Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">;

describe("DispatchDetectRepurposeUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues one job per distinct account with active channels", async () => {
    const { queue, calls } = makeQueue(okEnqueue);
    const channelQuery = makeChannelQuery([
      ch("c1", "acc-1"),
      ch("c2", "acc-1"),
      ch("c3", "acc-2"),
    ]);
    const uc = new DispatchDetectRepurposeUseCase(channelQuery, queue, "detect-repurpose");

    const result = await uc.execute({});

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, { dispatched: 2, skipped: 0 });
    assert.strictEqual(calls.length, 2);
    const day = new Date().toISOString().slice(0, 10);
    const dedupeKeys = (calls as Array<{ dedupeKey: string; payload: { accountId: string } }>)
      .map((c) => c.dedupeKey)
      .sort();
    assert.deepStrictEqual(dedupeKeys, [
      `detect-repurpose-acc-1-${day}`,
      `detect-repurpose-acc-2-${day}`,
    ]);
  });

  it("counts enqueue failures as skipped", async () => {
    const { queue } = makeQueue(async () => err("CONNECTION_ERROR"));
    const uc = new DispatchDetectRepurposeUseCase(
      makeChannelQuery([ch("c1", "acc-1")]),
      queue,
      "detect-repurpose"
    );

    const result = await uc.execute({});

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, { dispatched: 0, skipped: 1 });
  });

  it("scopes detection to a single account when accountId is given", async () => {
    const findActiveChannels = vi.fn(async () => [ch("c1", "acc-9")]);
    const channelQuery = { findActiveChannels } as unknown as ChannelQueryForIngestion;
    const { queue } = makeQueue(okEnqueue);
    const uc = new DispatchDetectRepurposeUseCase(channelQuery, queue, "detect-repurpose");

    await uc.execute({ accountId: "acc-9" });

    assert.deepStrictEqual(findActiveChannels.mock.calls[0], ["acc-9"]);
  });

  it("runs inside the unit of work when one is provided", async () => {
    const { queue } = makeQueue(okEnqueue);
    let txUsed = false;
    const uow = {
      executeInTransaction: async (fn: () => Promise<void>) => {
        txUsed = true;
        await fn();
      },
    };
    const uc = new DispatchDetectRepurposeUseCase(
      makeChannelQuery([ch("c1", "acc-1")]),
      queue,
      "detect-repurpose",
      uow as never
    );

    const result = await uc.execute({});

    assert.ok(result.ok);
    assert.strictEqual(txUsed, true);
    assert.deepStrictEqual(result.value, { dispatched: 1, skipped: 0 });
  });
});
