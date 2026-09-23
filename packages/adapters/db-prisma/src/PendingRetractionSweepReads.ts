/**
 * @file PendingRetractionSweepReads.ts
 * @description Prisma read for the action-window sweep's discovery step.
 *
 *              ONE statement, no transaction and no write. That is the whole
 *              surface deliberately: the rows it returns are identifiers the caller
 *              re-reads under each row's own tenant before touching anything, so
 *              this adapter never needs — and must never acquire — a write path.
 *
 *              The predicate mirrors the partial index that serves it
 *              (`actionWindowStartedAt` where `pendingRetraction` and
 *              `actionWindowExpiredAt IS NULL`). It runs cross-account, which is
 *              legal only inside the declared system context its caller opens; the
 *              tenant guard steps aside there, and the row-security policy admits
 *              every row under the system sentinel.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  PendingRetractionSweepQuery,
  PendingRetractionSweepReader,
  PendingRetractionSweepRow,
} from "@core/domain/repositories/PendingRetractionSweepReader.js";

export class PendingRetractionSweepReads implements PendingRetractionSweepReader {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method listExpired
   * @description Reads one page of channels whose customer action window has closed.
   *
   *   All four clauses are load-bearing and none is implied by another: the first
   *   two are what makes the obligation the customer's at all, the third is what
   *   stops an already-settled row from being re-selected on every tick forever, and
   *   the fourth is the deadline itself.
   * @param query - The cutoff (`now − window`) and the page size
   * @returns The selected rows, oldest window first
   */
  async listExpired(
    query: PendingRetractionSweepQuery
  ): Promise<readonly PendingRetractionSweepRow[]> {
    return this.prisma.postChannelPublication.findMany({
      where: {
        pendingRetraction: true,
        retractionBlockedCause: { not: null },
        actionWindowExpiredAt: null,
        actionWindowStartedAt: { lte: query.olderThan },
      },
      // The page is bounded, so this order decides who waits. `id` breaks the tie
      // so two rows sharing a window instant cannot swap places between ticks and
      // leave one of them permanently on the far side of the page.
      orderBy: [{ actionWindowStartedAt: "asc" }, { id: "asc" }],
      select: { postId: true, channelId: true, accountId: true },
      take: query.limit,
    });
  }
}
