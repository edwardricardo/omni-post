/**
 * @file PrismaBulkScheduleBatchRepository.ts
 * @description Prisma adapter for the bulk-scheduling manifest command port.
 *   UoW-aware: every write resolves the active transaction client from
 *   `PrismaUnitOfWork` (AsyncLocalStorage) so manifest writes join the caller's
 *   transaction. All item mutations are idempotent so BullMQ at-least-once
 *   delivery is safe. Batch completion is best-effort here (count + conditional
 *   update); the read side derives the authoritative status from item state, so
 *   a rare concurrent-finish race never shows the consumer a stale PROCESSING.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  BulkScheduleBatchRepository,
  BulkScheduleItemState,
  BulkScheduleItemStatus,
  NewBulkScheduleBatch,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class PrismaBulkScheduleBatchRepository implements BulkScheduleBatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active UoW transaction client, or the base client. */
  private client(): DbClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * @method createBatch
   * @description Persist a batch and all its items in one nested write.
   */
  async createBatch(batch: NewBulkScheduleBatch): Promise<void> {
    await this.client().bulkScheduleBatch.create({
      data: {
        id: batch.id,
        accountId: batch.accountId,
        projectId: batch.projectId,
        totalRows: batch.totalRows,
        status: batch.status,
        items: {
          create: batch.items.map((item) => ({
            id: item.id,
            rowNumber: item.rowNumber,
            provider: item.provider,
            status: item.status,
            ...(item.errorMessage !== undefined && { errorMessage: item.errorMessage }),
          })),
        },
      },
    });
  }

  /**
   * @method findItem
   * @description Minimal item state for the worker's idempotency guard.
   */
  async findItem(itemId: string): Promise<BulkScheduleItemState | null> {
    const row = await this.client().bulkScheduleItem.findUnique({
      where: { id: itemId },
      select: { id: true, batchId: true, status: true, postId: true },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      batchId: row.batchId,
      status: row.status as BulkScheduleItemStatus,
      postId: row.postId,
    };
  }

  /**
   * @method markItemPostCreated
   * @description Record the created post id while leaving the item PENDING, so a
   *   retry after a crash between create and schedule reuses the post.
   */
  async markItemPostCreated(itemId: string, postId: string): Promise<void> {
    await this.client().bulkScheduleItem.update({
      where: { id: itemId },
      data: { postId },
    });
  }

  /**
   * @method markItemScheduled
   * @description Mark an item SCHEDULED with its post id.
   */
  async markItemScheduled(itemId: string, postId: string): Promise<void> {
    await this.client().bulkScheduleItem.update({
      where: { id: itemId },
      data: { status: "SCHEDULED", postId },
    });
  }

  /**
   * @method markItemFailed
   * @description Mark an item FAILED with a reason.
   */
  async markItemFailed(itemId: string, errorMessage: string): Promise<void> {
    await this.client().bulkScheduleItem.update({
      where: { id: itemId },
      data: { status: "FAILED", errorMessage },
    });
  }

  /**
   * @method completeBatchIfSettled
   * @description Best-effort transition to COMPLETED when no item remains
   *   PENDING. Runs inside the caller's transaction, so it observes that
   *   transaction's just-written item state. The read side independently derives
   *   COMPLETED from item state, so a concurrent-finish race that misses here is
   *   invisible to consumers.
   */
  async completeBatchIfSettled(batchId: string): Promise<void> {
    const client = this.client();
    const pending = await client.bulkScheduleItem.count({
      where: { batchId, status: "PENDING" },
    });
    if (pending === 0) {
      await client.bulkScheduleBatch.updateMany({
        where: { id: batchId, status: "PROCESSING" },
        data: { status: "COMPLETED" },
      });
    }
  }
}
