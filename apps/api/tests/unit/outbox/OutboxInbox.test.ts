/**
 * @file OutboxInbox.test.ts
 * @description Tests for `OutboxInbox` — consumer dedupe.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { OutboxInbox } from "../../../src/infrastructure/outbox/OutboxInbox.js";

function createMockPrisma() {
  return {
    outboxInbox: {
      create: vi.fn(async (_args: unknown) => ({})),
    },
  };
}

describe("OutboxInbox", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let inbox: OutboxInbox;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    inbox = new OutboxInbox(mockPrisma as never);
  });

  it("returns true for a fresh messageId and persists the row", async () => {
    const result = await inbox.tryClaimForProcessing("msg-1", "consumer-A");
    expect(result).toBe(true);
    expect(mockPrisma.outboxInbox.create.mock.calls.length).toBe(1);
    const args = mockPrisma.outboxInbox.create.mock.calls[0]?.[0] as {
      data: { messageId: string; consumerId: string };
    };
    expect(args.data.messageId).toBe("msg-1");
    expect(args.data.consumerId).toBe("consumer-A");
  });

  it("returns false when create raises a Prisma P2002 unique-constraint error", async () => {
    const uniqueError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockPrisma.outboxInbox.create = vi.fn(async () => {
      throw uniqueError;
    });

    const result = await inbox.tryClaimForProcessing("msg-dup", "consumer-A");
    expect(result).toBe(false);
  });

  it("rethrows non-P2002 errors so callers can react to infra failures", async () => {
    const dbError = Object.assign(new Error("Connection lost"), { code: "P1001" });
    mockPrisma.outboxInbox.create = vi.fn(async () => {
      throw dbError;
    });

    await expect(inbox.tryClaimForProcessing("msg-1", "consumer-A")).rejects.toThrow(
      "Connection lost"
    );
  });

  it("rethrows errors that have no `code` property (defensive)", async () => {
    mockPrisma.outboxInbox.create = vi.fn(async () => {
      throw new Error("plain error");
    });

    await expect(inbox.tryClaimForProcessing("msg-1", "consumer-A")).rejects.toThrow("plain error");
  });

  it("persists `consumerId` exactly as passed (no normalisation)", async () => {
    await inbox.tryClaimForProcessing("msg-2", "Notification-Broadcaster-pid-42");
    const args = mockPrisma.outboxInbox.create.mock.calls[0]?.[0] as {
      data: { consumerId: string };
    };
    expect(args.data.consumerId).toBe("Notification-Broadcaster-pid-42");
  });
});
