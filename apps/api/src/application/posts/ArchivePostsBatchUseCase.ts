/**
 * @file ArchivePostsBatchUseCase.ts
 * @description Bulk-archive command — stamps archivedAt on every input post
 *              within a Unit-of-Work transaction. Skips posts that are
 *              soft-deleted or already archived (idempotent).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { PostId, type PostRepository } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

const MAX_BATCH_SIZE = 100;

/**
 * Input DTO for archiving a batch of posts.
 */
export interface ArchivePostsBatchInput {
  postIds: string[];
}

/**
 * Output DTO — count of rows whose archivedAt was set in this call.
 */
export interface ArchivePostsBatchOutput {
  archived: number;
  /** Subset of input ids that were rejected for being malformed UUIDs. */
  invalidIds: string[];
}

/**
 * Archive Posts Batch Use Case
 *
 * Validates every input id, then issues a single Prisma updateMany inside a
 * transaction. Posts already archived or soft-deleted are silently skipped
 * (matching `bulkUpdateStatus` semantics — bulk operations don't fail on a
 * subset miss).
 *
 * Caps the input at MAX_BATCH_SIZE to prevent runaway updateManys.
 */
export class ArchivePostsBatchUseCase implements UseCase<
  ArchivePostsBatchInput,
  ArchivePostsBatchOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: ArchivePostsBatchInput
  ): Promise<Result<ArchivePostsBatchOutput, UseCaseError>> {
    if (!input.postIds || input.postIds.length === 0) {
      return err(
        new UseCaseError("postIds is required and non-empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    if (input.postIds.length > MAX_BATCH_SIZE) {
      return err(
        new UseCaseError(
          `Batch size exceeds limit (${input.postIds.length} > ${MAX_BATCH_SIZE})`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const postIds: PostId[] = [];
    const invalidIds: string[] = [];
    for (const raw of input.postIds) {
      const parsed = PostId.fromString(raw);
      if (parsed.ok) {
        postIds.push(parsed.value);
      } else {
        invalidIds.push(raw);
      }
    }

    if (postIds.length === 0) {
      return ok({ archived: 0, invalidIds });
    }

    const doWork = async (): Promise<Result<ArchivePostsBatchOutput, UseCaseError>> => {
      const result = await this.postRepository.bulkArchive(postIds);
      if (!result.ok) {
        return err(
          new UseCaseError(
            `Bulk archive failed: ${result.error.message}`,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            result.error
          )
        );
      }
      return ok({ archived: result.value, invalidIds });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ArchivePostsBatchOutput, UseCaseError> = ok({
          archived: 0,
          invalidIds,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Bulk archive transaction failed",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
