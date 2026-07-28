/**
 * @file ChannelAuthFailureRecorder.tenantScope.test.ts
 * @description Unit tests for tenant-scoped auth-failure recording.
 *   `record(channelId, provider, reason, accountId)` MUST scope its channel
 *   update by `{ id, accountId }`: an own-scope caller flips `needsReauth` and
 *   emits the `ChannelAuthFailed` outbox event, while a foreign-scope caller
 *   matches no row (Prisma P2025) and the recorder swallows it as a no-op — a
 *   foreign tenant can never flip another tenant's channel state
 *   (404-equivalent semantics). No DB; a fake Prisma transaction stands in for
 *   the client.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import type pino from "pino";
import { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";

const CHANNEL_ID = "ch-owned-by-a";
const OWNER_ACCOUNT_ID = "acct-a";
const FOREIGN_ACCOUNT_ID = "acct-b";
const REASON = "token expired";

interface LoggedCall {
  context: Record<string, unknown>;
  message: string;
}

/** Logger double recording the WARN calls the swallowed-P2025 path emits. */
function createRecordingLogger(): { logger: pino.Logger; warns: LoggedCall[] } {
  const warns: LoggedCall[] = [];
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((context: Record<string, unknown>, message: string) => {
      warns.push({ context, message });
    }),
  } as unknown as pino.Logger;
  return { logger, warns };
}

interface RecordedOps {
  channelUpdates: Array<{
    where: { id: string; accountId?: string };
    data: Record<string, unknown>;
  }>;
  outboxCreates: Array<{ data: Record<string, unknown> }>;
}

/**
 * Fake Prisma whose `channel.update` models the tenant-scoped WHERE the recorder
 * issues: the update matches only when its `accountId` equals the row owner's,
 * and otherwise raises Prisma's P2025 ("record not found") — the exact failure a
 * foreign-scope update hits. Pass `ownerAccountId: null` to model the row being
 * absent altogether (own tenant, channel hard-deleted), which produces the same
 * P2025 from a completely different operational cause.
 */
function createScopedMockPrisma(ownerAccountId: string | null): {
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
          if (args.where.accountId !== ownerAccountId) {
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

describe("ChannelAuthFailureRecorder — tenant-scoped record", () => {
  let mock: ReturnType<typeof createScopedMockPrisma>;
  let recorder: ChannelAuthFailureRecorder;
  let warns: LoggedCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createScopedMockPrisma(OWNER_ACCOUNT_ID);
    const recording = createRecordingLogger();
    warns = recording.warns;
    recorder = new ChannelAuthFailureRecorder({
      prisma: mock.prisma as never,
      logger: recording.logger,
    });
  });

  describe("own-scope caller", () => {
    it("scopes the update by { id, accountId } and flips needsReauth + emits the outbox event", async () => {
      await recorder.record(CHANNEL_ID, "x", REASON, OWNER_ACCOUNT_ID);

      expect(mock.ops.channelUpdates.length).toBe(1);
      const update = mock.ops.channelUpdates[0] as {
        where: { id: string; accountId?: string };
        data: { needsReauth: boolean; authFailureReason: string };
      };
      expect(update.where.id).toBe(CHANNEL_ID);
      expect(update.where.accountId).toBe(OWNER_ACCOUNT_ID);
      expect(update.data.needsReauth).toBe(true);
      expect(update.data.authFailureReason).toBe(REASON);
      expect(mock.ops.outboxCreates.length).toBe(1);
      expect(warns).toStrictEqual([]);
    });
  });

  describe("foreign-scope caller", () => {
    it("is a no-op (P2025 swallowed): flips no flag and emits no event for another tenant's channel", async () => {
      await expect(
        recorder.record(CHANNEL_ID, "x", REASON, FOREIGN_ACCOUNT_ID)
      ).resolves.toBeUndefined();

      expect(mock.ops.channelUpdates.length).toBe(0);
      expect(mock.ops.outboxCreates.length).toBe(0);
    });

    it("logs the swallowed no-op at WARN with the identifying context, never the reason", async () => {
      await recorder.record(CHANNEL_ID, "x", REASON, FOREIGN_ACCOUNT_ID);

      // A cross-tenant recorder call is a security-relevant signal; swallowing
      // it with zero telemetry makes it indistinguishable from success.
      expect(warns.length).toBe(1);
      expect(warns[0]?.context).toStrictEqual({
        channelId: CHANNEL_ID,
        accountId: FOREIGN_ACCOUNT_ID,
        provider: "x",
      });
      expect(JSON.stringify(warns[0]?.context)).not.toContain(REASON);
    });
  });

  describe("own tenant whose channel row is gone", () => {
    it("stays a no-op but WARNs, so a reauth that can never be recorded is visible", async () => {
      mock = createScopedMockPrisma(null);
      const recording = createRecordingLogger();
      warns = recording.warns;
      recorder = new ChannelAuthFailureRecorder({
        prisma: mock.prisma as never,
        logger: recording.logger,
      });

      await expect(
        recorder.record(CHANNEL_ID, "x", REASON, OWNER_ACCOUNT_ID)
      ).resolves.toBeUndefined();

      // Operationally the OPPOSITE of a foreign-tenant call: this is a real
      // auth failure that now never flips `needsReauth`, emits no outbox event,
      // and never tells the user to re-authenticate.
      expect(mock.ops.channelUpdates.length).toBe(0);
      expect(mock.ops.outboxCreates.length).toBe(0);
      expect(warns.length).toBe(1);
      expect(warns[0]?.context).toStrictEqual({
        channelId: CHANNEL_ID,
        accountId: OWNER_ACCOUNT_ID,
        provider: "x",
      });
    });
  });
});
