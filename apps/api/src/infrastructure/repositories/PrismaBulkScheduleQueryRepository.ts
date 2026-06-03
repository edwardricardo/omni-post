/**
 * @file PrismaBulkScheduleQueryRepository.ts
 * @description Prisma adapter for the bulk-scheduling manifest read port. Scopes
 *   every read to `accountId` directly in the query (a foreign batch reads as
 *   null — multi-tenant safe) and derives the authoritative batch status from
 *   item state: a batch stored as PROCESSING but whose items are all terminal is
 *   reported COMPLETED, making the eventual-consistency window invisible to the
 *   consumer without any locking on the write path.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  BulkScheduleQueryRepository,
  BulkScheduleBatchDTO,
  BulkScheduleItemDTO,
} from "@core/domain/repositories/BulkScheduleQueryRepository.js";
import type {
  BulkScheduleBatchStatus,
  BulkScheduleItemStatus,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";

export class PrismaBulkScheduleQueryRepository implements BulkScheduleQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method getBatch
   * @description Return a batch + its per-row items ordered by rowNumber, scoped
   *   to `accountId`. Returns null when absent or owned by another account.
   */
  async getBatch(accountId: string, batchId: string): Promise<BulkScheduleBatchDTO | null> {
    const row = await this.prisma.bulkScheduleBatch.findFirst({
      where: { id: batchId, accountId },
      include: { items: { orderBy: { rowNumber: "asc" } } },
    });
    if (!row) {
      return null;
    }

    const items: BulkScheduleItemDTO[] = row.items.map((item) => ({
      id: item.id,
      rowNumber: item.rowNumber,
      status: item.status as BulkScheduleItemStatus,
      postId: item.postId,
      errorMessage: item.errorMessage,
    }));

    // Derive the authoritative status: all-terminal items ⇒ COMPLETED, even if
    // the stored column still says PROCESSING (concurrent-finish race).
    const allTerminal = items.every((i) => i.status !== "PENDING");
    const storedStatus = row.status as BulkScheduleBatchStatus;
    const status: BulkScheduleBatchStatus =
      storedStatus === "PROCESSING" && allTerminal ? "COMPLETED" : storedStatus;

    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      totalRows: row.totalRows,
      status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items,
    };
  }
}
