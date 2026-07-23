/**
 * @file ChannelAuthFailureRecorder.tenantScope.test.ts
 * @description RED (strict-TDD) unit tests for tenant-scoped auth-failure
 *   recording (design D9). `record(channelId, provider, reason, accountId)` MUST
 *   scope its channel update by `{ id, accountId }`: an own-scope caller flips
 *   `needsReauth` and emits the `ChannelAuthFailed` outbox event, while a
 *   foreign-scope caller matches no row (Prisma P2025) and the recorder swallows
 *   it as a no-op — a foreign tenant can never flip another tenant's channel
 *   state (404-equivalent semantics). These tests reference the four-argument
 *   `record` form plus the P2025 no-op that do not exist yet — they stay RED
 *   until Phase 10.4. No DB; a fake Prisma transaction stands in for the client.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";

const CHANNEL_ID = "ch-owned-by-a";
const OWNER_ACCOUNT_ID = "acct-a";
const FOREIGN_ACCOUNT_ID = "acct-b";

interface RecordedOps {
  channelUpdates: Array<{
    where: { id: string; accountId?: string };
    data: Record<string, unknown>;
  }>;
  outboxCreates: Array<{ data: Record<string, unknown> }>;
}

/**
 * Fake Prisma whose `channel.update` models a tenant-scoped WHERE: when the
 * update carries an `accountId` that does not match the row owner, Prisma raises
 * P2025 ("record not found") — exactly what a foreign-scope update hits. An
 * update with no `accountId` (today's un-scoped behavior) always matches, which
 * is precisely the isolation gap these RED tests pin.
 */
function createScopedMockPrisma(ownerAccountId: string): {
  prisma: { $transaction: ReturnType<typeof vi.fn> };
  ops: RecordedOps;
} {
  const ops: RecordedOps = { channelUpdates: [], outboxCreates: [] };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    channel: {
      update: vi.fn(
        async (args: {
          where: { id: string; accountId?: string };
          data: Record<string, unknown>;
        }) => {
          if (args.where.accountId !== undefined && args.where.accountId !== ownerAccountId) {
            const notFound = new Error("No record was found for an update.") as Error & {
              code: string;
            };
            notFound.code = "P2025";
            throw notFound;
          }
          ops.channelUpdates.push(args);
          return {};
        }
      ),
    },
    outboxEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        ops.outboxCreates.push(args);
        return {};
      }),
    },
  };
  type TxClient = typeof tx;
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: TxClient) => Promise<void>): Promise<void> => {
      await callback(tx);
    }),
  };
  return { prisma, ops };
}

describe("ChannelAuthFailureRecorder — tenant-scoped record (D9)", () => {
  let mock: ReturnType<typeof createScopedMockPrisma>;
  let recorder: ChannelAuthFailureRecorder;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createScopedMockPrisma(OWNER_ACCOUNT_ID);
    recorder = new ChannelAuthFailureRecorder({ prisma: mock.prisma as never });
  });

  describe("own-scope caller", () => {
    it("scopes the update by { id, accountId } and flips needsReauth + emits the outbox event", async () => {
      await recorder.record(CHANNEL_ID, "x", "token expired", OWNER_ACCOUNT_ID);

      expect(mock.ops.channelUpdates.length).toBe(1);
      const update = mock.ops.channelUpdates[0] as {
        where: { id: string; accountId?: string };
        data: { needsReauth: boolean; authFailureReason: string };
      };
      expect(update.where.id).toBe(CHANNEL_ID);
      expect(update.where.accountId).toBe(OWNER_ACCOUNT_ID);
      expect(update.data.needsReauth).toBe(true);
      expect(update.data.authFailureReason).toBe("token expired");
      expect(mock.ops.outboxCreates.length).toBe(1);
    });
  });

  describe("foreign-scope caller", () => {
    it("is a no-op (P2025 swallowed): flips no flag and emits no event for another tenant's channel", async () => {
      await expect(
        recorder.record(CHANNEL_ID, "x", "token expired", FOREIGN_ACCOUNT_ID)
      ).resolves.toBeUndefined();

      expect(mock.ops.channelUpdates.length).toBe(0);
      expect(mock.ops.outboxCreates.length).toBe(0);
    });
  });
});
