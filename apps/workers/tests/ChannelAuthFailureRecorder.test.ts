/**
 * @file ChannelAuthFailureRecorder.test.ts
 * @description Tests for the worker-side recorder that flips the channel's
 *   `needsReauth` flag and emits a `ChannelAuthFailed` event to the outbox
 *   — both within the same Prisma transaction.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";

interface MockTxOps {
  channelUpdates: Array<{ where: unknown; data: unknown }>;
  outboxCreates: Array<{ data: unknown }>;
}

function createMockPrisma(opts: { txThrows?: Error } = {}): {
  prisma: { $transaction: ReturnType<typeof vi.fn> };
  ops: MockTxOps;
} {
  const ops: MockTxOps = { channelUpdates: [], outboxCreates: [] };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    channel: {
      update: vi.fn(async (args: { where: unknown; data: unknown }) => {
        ops.channelUpdates.push(args);
        return {};
      }),
    },
    outboxEvent: {
      create: vi.fn(async (args: { data: unknown }) => {
        ops.outboxCreates.push(args);
        return {};
      }),
    },
  };
  type TxClient = typeof tx;
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: TxClient) => Promise<void>): Promise<void> => {
      await callback(tx);
      if (opts.txThrows) {
        // Simulate Prisma rolling back: reset the captured ops.
        ops.channelUpdates.length = 0;
        ops.outboxCreates.length = 0;
        throw opts.txThrows;
      }
    }),
  };
  return { prisma, ops };
}

describe("ChannelAuthFailureRecorder", () => {
  let mock: ReturnType<typeof createMockPrisma>;
  let recorder: ChannelAuthFailureRecorder;

  beforeEach(() => {
    mock = createMockPrisma();
    recorder = new ChannelAuthFailureRecorder({ prisma: mock.prisma as never });
  });

  it("flips needsReauth and emits the outbox event in a single transaction", async () => {
    await recorder.record("ch-1", "x", "token expired", "acct-1");

    expect(mock.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.ops.channelUpdates.length).toBe(1);
    expect(mock.ops.outboxCreates.length).toBe(1);

    const update = mock.ops.channelUpdates[0] as {
      where: { id: string };
      data: { needsReauth: boolean; authFailedAt: Date; authFailureReason: string };
    };
    expect(update.where.id).toBe("ch-1");
    expect(update.data.needsReauth).toBe(true);
    expect(update.data.authFailedAt).toBeInstanceOf(Date);
    expect(update.data.authFailureReason).toBe("token expired");
  });

  it("emits ChannelAuthFailed with canonical eventType and aggregate metadata", async () => {
    await recorder.record("ch-2", "instagram", "scope revoked", "acct-1");

    const create = mock.ops.outboxCreates[0] as {
      data: {
        eventType: string;
        aggregateType: string;
        aggregateId: string;
        version: number;
        occurredAt: Date;
        payload: { channelId: string; provider: string; reason: string; detectedAt: string };
      };
    };
    expect(create.data.eventType).toBe("ChannelAuthFailed");
    expect(create.data.aggregateType).toBe("Channel");
    expect(create.data.aggregateId).toBe("ch-2");
    expect(create.data.version).toBe(1);
    expect(create.data.occurredAt).toBeInstanceOf(Date);
    expect(create.data.payload.channelId).toBe("ch-2");
    expect(create.data.payload.provider).toBe("instagram");
    expect(create.data.payload.reason).toBe("scope revoked");
    expect(typeof create.data.payload.detectedAt).toBe("string");
  });

  it("rolls back the outbox write when the transaction throws", async () => {
    mock = createMockPrisma({ txThrows: new Error("constraint violation") });
    recorder = new ChannelAuthFailureRecorder({ prisma: mock.prisma as never });

    await expect(recorder.record("ch-3", "x", "auth", "acct-1")).rejects.toThrow(
      "constraint violation"
    );
    expect(mock.ops.channelUpdates.length).toBe(0);
    expect(mock.ops.outboxCreates.length).toBe(0);
  });

  it("handles repeated calls with the same channelId by re-flipping flags + new event", async () => {
    await recorder.record("ch-4", "x", "first", "acct-1");
    await recorder.record("ch-4", "x", "second", "acct-1");

    expect(mock.ops.channelUpdates.length).toBe(2);
    expect(mock.ops.outboxCreates.length).toBe(2);
    const updates = mock.ops.channelUpdates as Array<{ data: { authFailureReason: string } }>;
    expect(updates[0]?.data.authFailureReason).toBe("first");
    expect(updates[1]?.data.authFailureReason).toBe("second");
  });

  it("uses an opaque uuid for the outbox row id (one per call, never colliding)", async () => {
    await recorder.record("ch-5", "x", "r", "acct-1");
    await recorder.record("ch-6", "x", "r", "acct-1");
    const ids = mock.ops.outboxCreates.map((c) => (c.data as { id: string }).id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(typeof ids[0]).toBe("string");
    expect(ids[0]?.length).toBeGreaterThan(10);
  });
});
