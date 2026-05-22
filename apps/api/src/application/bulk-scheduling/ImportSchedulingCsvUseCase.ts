/**
 * @file ImportSchedulingCsvUseCase.ts
 * @description Mutating use case for a bulk-scheduling CSV import. Validates
 *              project ownership, parses + per-row-validates the CSV (F1-API-2),
 *              persists a manifest batch (valid rows → PENDING, parse-failed rows
 *              → FAILED) in one transaction, then fans out one BullMQ job per
 *              valid row via `enqueueBulk` — outside the transaction, because
 *              queue I/O must never run inside a DB transaction. A single bad row
 *              never aborts the batch.
 * @layer application
 */

import { randomUUID } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import type { QueuePort, QueueJob } from "@ports/core";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type {
  BulkScheduleBatchRepository,
  NewBulkScheduleItem,
} from "../../domain/repositories/BulkScheduleBatchRepository.js";
import { parseSchedulingCsv } from "./schedulingCsv.js";

/** Defensive upper bound on rows per import — protects the queue + DB. */
export const MAX_BULK_SCHEDULE_ROWS = 5000;

/** Account scope, target project, and raw CSV text. */
export interface ImportSchedulingCsvInput {
  accountId: string;
  projectId: string;
  csv: string;
}

/** Summary returned to the caller (202 Accepted). */
export interface ImportSchedulingCsvOutput {
  batchId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

/**
 * @class ImportSchedulingCsvUseCase
 * @description Turns a CSV upload into a tracked manifest batch plus one
 *   enqueued job per valid row.
 */
export class ImportSchedulingCsvUseCase implements UseCase<
  ImportSchedulingCsvInput,
  ImportSchedulingCsvOutput,
  UseCaseError
> {
  constructor(
    private readonly projectQueryRepo: ProjectQueryRepositoryPort,
    private readonly batchRepo: BulkScheduleBatchRepository,
    private readonly queue: QueuePort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates ownership, parses the CSV, persists the manifest, and
   *   enqueues the valid rows.
   * @param input - Account scope, project id, and CSV text.
   * @returns Batch summary on success; NOT_FOUND (project), VALIDATION_FAILED
   *   (header/parse error or row cap), or INTERNAL_ERROR.
   */
  async execute(
    input: ImportSchedulingCsvInput
  ): Promise<Result<ImportSchedulingCsvOutput, UseCaseError>> {
    // 1. Tenant ownership: the project must belong to the caller's account.
    let project: Awaited<ReturnType<ProjectQueryRepositoryPort["findById"]>>;
    try {
      project = await this.projectQueryRepo.findById(input.projectId);
    } catch (error: unknown) {
      return err(this.internal(error));
    }
    if (!project || project.deletedAt !== null || project.accountId !== input.accountId) {
      return err(
        new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // 2. Parse + per-row validation (pure — no I/O).
    const parsed = parseSchedulingCsv(input.csv);

    // 3. Header/parse-level failure (row 0) rejects the whole import — no batch.
    const headerError = parsed.errors.find((e) => e.row === 0);
    if (headerError) {
      return err(new UseCaseError(headerError.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // 4. Defensive row cap.
    if (parsed.totalDataRows > MAX_BULK_SCHEDULE_ROWS) {
      return err(
        new UseCaseError(
          `CSV exceeds the ${MAX_BULK_SCHEDULE_ROWS}-row limit (${parsed.totalDataRows} rows)`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // 5. Build manifest items. Valid rows → PENDING (+ a job); the first error
    //    per distinct row → a FAILED item (provider unknown at parse failure).
    const batchId = randomUUID();
    const validItems = parsed.validRows.map((row) => ({ id: randomUUID(), row }));

    const failedByRow = new Map<number, string>();
    for (const e of parsed.errors) {
      if (e.row >= 1 && !failedByRow.has(e.row)) {
        failedByRow.set(e.row, e.field !== undefined ? `${e.field}: ${e.message}` : e.message);
      }
    }

    const items: NewBulkScheduleItem[] = [
      ...validItems.map(({ id, row }) => ({
        id,
        rowNumber: row.row,
        provider: row.provider,
        status: "PENDING" as const,
      })),
      ...Array.from(failedByRow.entries()).map(([rowNumber, message]) => ({
        id: randomUUID(),
        rowNumber,
        provider: "",
        status: "FAILED" as const,
        errorMessage: message,
      })),
    ];

    const status = validItems.length > 0 ? ("PROCESSING" as const) : ("COMPLETED" as const);

    // 6. Persist batch + items atomically.
    const persist = async (): Promise<void> => {
      await this.batchRepo.createBatch({
        id: batchId,
        accountId: input.accountId,
        projectId: input.projectId,
        totalRows: parsed.totalDataRows,
        status,
        items,
      });
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(persist);
      } else {
        await persist();
      }
    } catch (error: unknown) {
      return err(this.internal(error));
    }

    // 7. Enqueue one job per valid row AFTER the batch commits. Queue I/O is an
    //    external call and must not sit inside the DB transaction.
    if (validItems.length > 0) {
      const jobs: QueueJob[] = validItems.map(({ id, row }) => ({
        dedupeKey: `bulk-${batchId}-${id}`,
        payload: {
          batchId,
          itemId: id,
          accountId: input.accountId,
          projectId: input.projectId,
          row: {
            provider: row.provider,
            content: row.content,
            scheduledFor: row.scheduledFor,
            timezone: row.timezone,
            ...(row.title !== undefined && { title: row.title }),
            mediaUrls: row.mediaUrls,
            tags: row.tags,
          },
        },
      }));

      const enqueued = await this.queue.enqueueBulk(jobs);
      if (!enqueued.ok) {
        return err(
          new UseCaseError(
            "Batch was saved but its rows could not be queued; retry the import",
            USE_CASE_ERRORS.INTERNAL_ERROR
          )
        );
      }
    }

    return ok({
      batchId,
      totalRows: parsed.totalDataRows,
      validRows: validItems.length,
      invalidRows: failedByRow.size,
    });
  }

  /** Wrap an unexpected failure as an INTERNAL_ERROR use-case error. */
  private internal(error: unknown): UseCaseError {
    return new UseCaseError(
      "Failed to import scheduling CSV",
      USE_CASE_ERRORS.INTERNAL_ERROR,
      error instanceof Error ? error : undefined
    );
  }
}
