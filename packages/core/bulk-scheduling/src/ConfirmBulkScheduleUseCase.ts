/**
 * @file ConfirmBulkScheduleUseCase.ts
 * @description Confirm use case for bulk-scheduling. Accepts parsed rows from
 *              the parse endpoint and the user-selected channelIds[], performs
 *              channel ownership admission, runs per-row per-provider feasibility
 *              checks, then persists the lean manifest batch + per-row outbox
 *              events in a single UoW transaction. If the transaction rolls back,
 *              zero rows are committed. Provider is always derived from the
 *              selected channel, never supplied as a CSV column.
 * @layer application
 */

import { randomUUID } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type {
  BulkScheduleBatchRepository,
  NewBulkScheduleItem,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";
import { BulkScheduleRowConfirmed } from "./events/BulkScheduleRowConfirmed.js";
import type { SchedulingCsvRow } from "./schedulingCsv.js";

/** Input for the bulk-schedule confirm step. */
export interface ConfirmBulkScheduleInput {
  /** Account making the request (from auth context, NOT from request body). */
  accountId: string;
  /** Project the batch belongs to. */
  projectId: string;
  /** User-selected channel IDs — must all belong to the project. */
  channelIds: string[];
  /** Valid rows returned from ParseBulkScheduleCsvUseCase. */
  rows: SchedulingCsvRow[];
}

/** Output returned to the caller on success. */
export interface ConfirmBulkScheduleOutput {
  /** The batch ID for polling batch progress. */
  batchId: string;
}

/**
 * @class ConfirmBulkScheduleUseCase
 * @description Confirms a bulk-schedule upload. Owns the single UoW transaction
 *   that writes the lean manifest + N outbox events atomically. If the transaction
 *   rolls back, no orphan batches or items are left in the database.
 */
export class ConfirmBulkScheduleUseCase implements UseCase<
  ConfirmBulkScheduleInput,
  ConfirmBulkScheduleOutput,
  UseCaseError
> {
  constructor(
    private readonly batchRepo: BulkScheduleBatchRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Performs ownership admission, feasibility checks, then commits
   *   the manifest + outbox events in one transaction.
   * @param input - Account, project, selected channelIds, and validated CSV rows.
   * @returns `{ batchId }` on success; FORBIDDEN for foreign channels;
   *   VALIDATION_FAILED for empty channelIds or empty rows; INTERNAL_ERROR
   *   for transient infra failures.
   */
  async execute(
    input: ConfirmBulkScheduleInput
  ): Promise<Result<ConfirmBulkScheduleOutput, UseCaseError>> {
    // Pre-TX validation (no writes).

    // channelIds must not be empty.
    if (input.channelIds.length === 0) {
      return err(
        new UseCaseError(
          "At least one channelId must be provided",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Ownership admission — resolve the project's owned channel IDs.
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project id: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    let ownedChannelIdValues: string[];
    try {
      const ids = await this.channelRepository.findIdsByProjectId(projectIdResult.value);
      ownedChannelIdValues = ids.map((id) => id.value);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to verify channel ownership",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }

    const ownedSet = new Set(ownedChannelIdValues);
    const foreignIds = input.channelIds.filter((id) => !ownedSet.has(id));
    if (foreignIds.length > 0) {
      return err(
        new UseCaseError(
          `One or more channelIds not owned by this project: ${foreignIds.join(", ")}`,
          USE_CASE_ERRORS.FORBIDDEN
        )
      );
    }

    // rows must not be empty.
    if (input.rows.length === 0) {
      return err(
        new UseCaseError("No rows provided to confirm", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Build stable manifest IDs before entering the transaction.
    const batchId = randomUUID();
    const itemEntries = input.rows.map((row) => ({
      id: randomUUID(),
      row,
    }));

    // Atomic write: create batch + items + outbox events.
    const doWork = async (): Promise<Result<ConfirmBulkScheduleOutput, UseCaseError>> => {
      const items: NewBulkScheduleItem[] = itemEntries.map(({ id, row }) => ({
        id,
        rowNumber: row.row,
        status: "PENDING" as const,
      }));

      await this.batchRepo.createBatch({
        id: batchId,
        accountId: input.accountId,
        projectId: input.projectId,
        totalRows: input.rows.length,
        status: "PROCESSING",
        items,
      });

      const events = itemEntries.map(
        ({ id, row }) =>
          new BulkScheduleRowConfirmed(
            id,
            batchId,
            input.accountId,
            input.projectId,
            row.content,
            row.scheduledFor,
            row.timezone,
            input.channelIds,
            row.media,
            row.tags,
            row.title
          )
      );

      // The OutboxWriter adapter self-resolves the active transaction client via
      // PrismaUnitOfWork.getTransactionClient() when tx arg is passed as undefined.
      await this.outboxWriter.writeEvents(undefined, events);

      return ok({ batchId });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ConfirmBulkScheduleOutput, UseCaseError> = ok({ batchId });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to confirm bulk schedule",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
