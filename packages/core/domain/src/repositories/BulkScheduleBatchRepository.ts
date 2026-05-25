/**
 * @file BulkScheduleBatchRepository.ts
 * @description Command-side port for the bulk-CSV-scheduling manifest. A batch
 *              tracks one import (a CSV upload); each item tracks the outcome of
 *              one CSV data row. The worker advances item state independently
 *              (one job per row) via intention-revealing methods — there is no
 *              whole-aggregate load per row, which would serialise concurrent
 *              row jobs. All methods are idempotent so the BullMQ at-least-once
 *              delivery never produces a wrong result on retry.
 * @layer domain
 */

/** Lifecycle of a single manifest row. */
export type BulkScheduleItemStatus = "PENDING" | "SCHEDULED" | "FAILED";

/** Lifecycle of a manifest batch — COMPLETED once no item remains PENDING. */
export type BulkScheduleBatchStatus = "PROCESSING" | "COMPLETED";

/** A manifest item as persisted when the batch is first created. */
export interface NewBulkScheduleItem {
  /** Caller-generated UUID — also embedded in the row job payload. */
  id: string;
  /** 1-based CSV data row number (header excluded). */
  rowNumber: number;
  /** Provider id for valid rows; empty string for parse-failed rows. */
  provider: string;
  /** Only PENDING (valid row, awaiting its job) or FAILED (parse error). */
  status: Extract<BulkScheduleItemStatus, "PENDING" | "FAILED">;
  /** Parse error message — present only for FAILED items. */
  errorMessage?: string;
}

/** A new manifest batch plus its items, persisted atomically. */
export interface NewBulkScheduleBatch {
  id: string;
  accountId: string;
  projectId: string;
  /** Total CSV data rows (valid + invalid). */
  totalRows: number;
  /** PROCESSING when there are PENDING items; COMPLETED when all are terminal. */
  status: BulkScheduleBatchStatus;
  items: NewBulkScheduleItem[];
}

/** Minimal item state the worker reads to enforce idempotency before acting. */
export interface BulkScheduleItemState {
  id: string;
  batchId: string;
  status: BulkScheduleItemStatus;
  /** Set once the post for this row has been created (survives retries). */
  postId: string | null;
}

/**
 * Repository port (command side) for the bulk-scheduling manifest.
 */
export interface BulkScheduleBatchRepository {
  /**
   * Persist a batch and all its items in a single transaction.
   */
  createBatch(batch: NewBulkScheduleBatch): Promise<void>;

  /**
   * Read the minimal state of one item, or null if it no longer exists.
   * Used by the worker's idempotency guard.
   */
  findItem(itemId: string): Promise<BulkScheduleItemState | null>;

  /**
   * Record the post created for a row before scheduling, so a retry after a
   * crash between create and schedule reuses the post instead of duplicating
   * it. Leaves the item PENDING. Idempotent.
   */
  markItemPostCreated(itemId: string, postId: string): Promise<void>;

  /**
   * Mark an item SCHEDULED with its post id. Idempotent.
   */
  markItemScheduled(itemId: string, postId: string): Promise<void>;

  /**
   * Mark an item FAILED with a human-readable reason. Idempotent.
   */
  markItemFailed(itemId: string, errorMessage: string): Promise<void>;

  /**
   * Transition the batch to COMPLETED when no item remains PENDING. No-op
   * while items are still pending or the batch is already COMPLETED.
   */
  completeBatchIfSettled(batchId: string): Promise<void>;
}
