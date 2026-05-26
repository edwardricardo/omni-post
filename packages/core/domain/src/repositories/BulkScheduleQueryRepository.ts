/**
 * @file BulkScheduleQueryRepository.ts
 * @description Read-side port for the bulk-scheduling manifest. Returns flat
 *              DTOs (never domain objects) scoped by accountId so a tenant can
 *              only ever read its own import batches (multi-tenant safe). Drives
 *              the F1-CLI-4 poll of per-row progress.
 * @layer domain
 */

import type {
  BulkScheduleBatchStatus,
  BulkScheduleItemStatus,
} from "./BulkScheduleBatchRepository.js";

/** One manifest row in the read model. */
export interface BulkScheduleItemDTO {
  id: string;
  rowNumber: number;
  provider: string;
  status: BulkScheduleItemStatus;
  /** Created post id once the row is SCHEDULED, else null. */
  postId: string | null;
  /** Failure reason once the row is FAILED, else null. */
  errorMessage: string | null;
}

/** A manifest batch with its per-row items, ordered by rowNumber. */
export interface BulkScheduleBatchDTO {
  id: string;
  accountId: string;
  projectId: string;
  totalRows: number;
  status: BulkScheduleBatchStatus;
  createdAt: Date;
  updatedAt: Date;
  items: BulkScheduleItemDTO[];
}

/**
 * Repository port (query side) for the bulk-scheduling manifest.
 */
export interface BulkScheduleQueryRepository {
  /**
   * Return a batch and its items, scoped to `accountId`. Returns null when the
   * batch does not exist or belongs to another account (tenant isolation).
   */
  getBatch(accountId: string, batchId: string): Promise<BulkScheduleBatchDTO | null>;
}
