/**
 * @file ProcessBulkScheduleRowUseCase.ts
 * @description Mutating use case run by the bulk-schedule worker, one invocation
 *              per CSV row job. It resolves the row's channels, creates the post
 *              (reusing `CreatePostUseCase`) and schedules it (`SchedulePostUseCase`),
 *              then advances the manifest item. It is idempotent: an already
 *              SCHEDULED/FAILED item is skipped, and a post created on a prior
 *              attempt is reused rather than duplicated. Deterministic failures
 *              (no channel, bad provider, scheduling rejected) mark the item
 *              FAILED and return ok — no retry. Transient failures (sub-use-case
 *              INTERNAL_ERROR or an unexpected error) return INTERNAL_ERROR so
 *              the worker (infrastructure) can re-raise it and let BullMQ retry →
 *              DLQ. The use case itself never raises (application-layer rule).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProjectId } from "@core/domain/index.js";
import { Provider } from "@core/domain/value-objects/Provider.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { BulkScheduleBatchRepository } from "@core/domain/repositories/BulkScheduleBatchRepository.js";
import type { PostCreationPort } from "@ports/core";

/** Validated row payload carried by the BullMQ job. */
export interface ProcessBulkScheduleRowInput {
  batchId: string;
  itemId: string;
  accountId: string;
  projectId: string;
  row: {
    provider: string;
    content: string;
    scheduledFor: string;
    timezone: string;
    title?: string;
    mediaUrls: string[];
    tags: string[];
  };
}

/** Per-row outcome. SKIPPED means the item was already terminal (idempotency). */
export interface ProcessBulkScheduleRowOutput {
  itemId: string;
  status: "SCHEDULED" | "FAILED" | "SKIPPED";
  postId?: string;
}

/**
 * @class ProcessBulkScheduleRowUseCase
 * @description Idempotent per-row processor for the bulk-scheduling worker.
 */
export class ProcessBulkScheduleRowUseCase implements UseCase<
  ProcessBulkScheduleRowInput,
  ProcessBulkScheduleRowOutput,
  UseCaseError
> {
  constructor(
    private readonly batchRepo: BulkScheduleBatchRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly postCreation: PostCreationPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Processes one row idempotently: guard → resolve channels →
   *   create → schedule → mark SCHEDULED (or FAILED on a deterministic error).
   * @param input - The row job payload.
   * @returns SCHEDULED/FAILED/SKIPPED on success, or INTERNAL_ERROR (transient)
   *   which the worker turns into a retry.
   */
  async execute(
    input: ProcessBulkScheduleRowInput
  ): Promise<Result<ProcessBulkScheduleRowOutput, UseCaseError>> {
    try {
      // 1. Idempotency guard — never reprocess a terminal item.
      const item = await this.batchRepo.findItem(input.itemId);
      if (!item) {
        return ok({ itemId: input.itemId, status: "SKIPPED" });
      }
      if (item.status === "SCHEDULED") {
        return ok({
          itemId: input.itemId,
          status: "SCHEDULED",
          ...(item.postId !== null && { postId: item.postId }),
        });
      }
      if (item.status === "FAILED") {
        return ok({ itemId: input.itemId, status: "FAILED" });
      }

      // 2. Resolve the row's channels (deterministic failure if none).
      const providerResult = Provider.fromString(input.row.provider);
      if (!providerResult.ok) {
        return this.fail(input, `Invalid provider: ${input.row.provider}`);
      }
      const projectIdResult = ProjectId.fromString(input.projectId);
      if (!projectIdResult.ok) {
        return this.fail(input, `Invalid project id: ${input.projectId}`);
      }
      const channels = await this.channelRepository.findByProjectAndProvider(
        projectIdResult.value,
        providerResult.value
      );
      if (channels.length === 0) {
        return this.fail(
          input,
          `No ${providerResult.value.type} channel connected for this project`
        );
      }
      const channelIds = channels.map((c) => c.id.value);

      // 3. Create the post — reuse the one from a prior attempt if present.
      let postId: string;
      if (item.postId !== null) {
        postId = item.postId;
      } else {
        const created = await this.postCreation.createPost({
          projectId: input.projectId,
          body: input.row.content,
          ...(input.row.title !== undefined && { title: input.row.title }),
          tags: input.row.tags,
        });
        if (!created.ok) {
          return this.classify(created.error, input);
        }
        postId = created.value.id;
        // Persist the post id BEFORE scheduling so a crash-then-retry reuses it.
        const persisted = await this.persistInTx(() =>
          this.batchRepo.markItemPostCreated(input.itemId, postId)
        );
        if (!persisted.ok) {
          return err(persisted.error);
        }
      }

      // 4. Schedule the post onto the resolved channels.
      const scheduled = await this.postCreation.schedulePost({
        postId,
        channelIds,
        scheduledFor: input.row.scheduledFor,
        timezone: input.row.timezone,
      });
      if (!scheduled.ok) {
        return this.classify(scheduled.error, input);
      }

      // 5. Mark SCHEDULED and complete the batch if this was the last pending row.
      const marked = await this.persistInTx(async () => {
        await this.batchRepo.markItemScheduled(input.itemId, postId);
        await this.batchRepo.completeBatchIfSettled(input.batchId);
      });
      if (!marked.ok) {
        return err(marked.error);
      }

      return ok({ itemId: input.itemId, status: "SCHEDULED", postId });
    } catch (error: unknown) {
      // Unexpected/infra error → transient → worker retries.
      return err(
        new UseCaseError(
          "Failed to process bulk schedule row",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  /**
   * Classify a sub-use-case failure: INTERNAL_ERROR is transient (retry via the
   * worker); anything else is deterministic (record FAILED, no retry).
   */
  private async classify(
    error: UseCaseError,
    input: ProcessBulkScheduleRowInput
  ): Promise<Result<ProcessBulkScheduleRowOutput, UseCaseError>> {
    if (error.code === USE_CASE_ERRORS.INTERNAL_ERROR) {
      return err(new UseCaseError(error.message, USE_CASE_ERRORS.INTERNAL_ERROR, error));
    }
    return this.fail(input, error.message);
  }

  /** Record a deterministic failure and settle the batch. Returns ok(FAILED). */
  private async fail(
    input: ProcessBulkScheduleRowInput,
    message: string
  ): Promise<Result<ProcessBulkScheduleRowOutput, UseCaseError>> {
    const res = await this.persistInTx(async () => {
      await this.batchRepo.markItemFailed(input.itemId, message);
      await this.batchRepo.completeBatchIfSettled(input.batchId);
    });
    if (!res.ok) {
      return err(res.error);
    }
    return ok({ itemId: input.itemId, status: "FAILED" });
  }

  /** Run a manifest write inside the UoW transaction (or directly in tests). */
  private async persistInTx(work: () => Promise<void>): Promise<Result<void, UseCaseError>> {
    try {
      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(work);
      } else {
        await work();
      }
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Bulk schedule manifest write failed",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
