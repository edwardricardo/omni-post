/**
 * @file mentionIngestWorker.tenantScope.test.ts
 * @description Unit tests for the mention-ingest channel lookup. The lookup runs
 *   on the RAW Prisma client, so its explicit `accountId` predicate IS the
 *   isolation: a job whose `accountId` does not own the channel must resolve
 *   nothing. The skip is silent by design (the job succeeds and nothing
 *   retries), so these tests also pin the telemetry that makes it observable.
 *   No DB; a fake transaction client stands in.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { resolveChannelAdapter } from "../src/mentionIngestWorker.js";
import {
  mentionChannelUnresolved,
  MENTION_CHANNEL_UNRESOLVED_REASONS,
} from "../src/metrics/mentionIngestMetrics.js";
import { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";
import type { IngestMentionUseCase } from "@core/listening/IngestMentionUseCase.js";
import type { PrismaClient } from "@infra/prisma";

const CHANNEL_ID = "ch-owned-by-a";
const OWNER_ACCOUNT_ID = "acct-a";
const FOREIGN_ACCOUNT_ID = "acct-b";

interface RecordedFind {
  where: { id: string; accountId?: string; deletedAt: null };
  select: Record<string, boolean>;
}

/**
 * Fake Prisma whose `channel.findFirst` models the tenant-scoped WHERE: a row
 * comes back only when the caller's `accountId` matches the owner. Records the
 * GUC binding too, since the same transaction must bind it.
 */
function createScopedMockPrisma(ownerAccountId: string): {
  prisma: PrismaClient;
  finds: RecordedFind[];
  gucBindings: unknown[][];
} {
  const finds: RecordedFind[] = [];
  const gucBindings: unknown[][] = [];
  const tx = {
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      gucBindings.push(args);
      return 1;
    }),
    channel: {
      findFirst: vi.fn(async (args: RecordedFind) => {
        finds.push(args);
        if (args.where.accountId !== ownerAccountId || args.where.id !== CHANNEL_ID) {
          return null;
        }
        return { id: CHANNEL_ID, provider: "X" };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return { prisma, finds, gucBindings };
}

function buildDeps(prisma: PrismaClient) {
  return {
    prisma,
    authFailureRecorder: new ChannelAuthFailureRecorder({ prisma }),
    ingestMention: {} as IngestMentionUseCase,
  };
}

async function readUnresolvedCounter(): Promise<
  Array<{ labels: Record<string, string | number>; value: number }>
> {
  const snapshot = await mentionChannelUnresolved.get();
  return snapshot.values as Array<{
    labels: Record<string, string | number>;
    value: number;
  }>;
}

describe("mentionIngestWorker — tenant-scoped channel lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mentionChannelUnresolved.reset();
  });

  describe("own-scope job", () => {
    it("binds the GUC, scopes the query by accountId, and resolves the provider adapter", async () => {
      const { prisma, finds, gucBindings } = createScopedMockPrisma(OWNER_ACCOUNT_ID);

      const resolved = await resolveChannelAdapter(CHANNEL_ID, OWNER_ACCOUNT_ID, buildDeps(prisma));

      expect(resolved?.providerName).toBe("x");
      expect(resolved?.providerEnum).toBe("X");
      expect(gucBindings.length).toBe(1);
      expect(finds.length).toBe(1);
      expect(finds[0]?.where).toStrictEqual({
        id: CHANNEL_ID,
        accountId: OWNER_ACCOUNT_ID,
        deletedAt: null,
      });
      // Never selects the credentials envelope.
      expect(finds[0]?.select).toStrictEqual({ id: true, provider: true });
      expect(await readUnresolvedCounter()).toStrictEqual([]);
    });
  });

  describe("foreign-scope job", () => {
    it("resolves nothing and counts the skip as not_found_in_scope", async () => {
      const { prisma, finds } = createScopedMockPrisma(OWNER_ACCOUNT_ID);

      const resolved = await resolveChannelAdapter(
        CHANNEL_ID,
        FOREIGN_ACCOUNT_ID,
        buildDeps(prisma)
      );

      expect(resolved).toBeUndefined();
      // The predicate — not a post-hoc ownership check — is what excludes it.
      expect(finds[0]?.where.accountId).toBe(FOREIGN_ACCOUNT_ID);
      expect(await readUnresolvedCounter()).toStrictEqual([
        {
          labels: { reason: MENTION_CHANNEL_UNRESOLVED_REASONS.notFoundInScope },
          value: 1,
        },
      ]);
    });
  });

  describe("job with no usable tenant scope", () => {
    it("never queries and counts the skip as invalid_scope", async () => {
      const { prisma, finds } = createScopedMockPrisma(OWNER_ACCOUNT_ID);

      const resolved = await resolveChannelAdapter(
        CHANNEL_ID,
        undefined as unknown as string,
        buildDeps(prisma)
      );

      // Prisma DROPS an `undefined` from a `where`, so an unvalidated scope
      // would widen the lookup to every tenant's channels.
      expect(resolved).toBeUndefined();
      expect(finds).toStrictEqual([]);
      expect(await readUnresolvedCounter()).toStrictEqual([
        {
          labels: { reason: MENTION_CHANNEL_UNRESOLVED_REASONS.invalidScope },
          value: 1,
        },
      ]);
    });
  });
});
