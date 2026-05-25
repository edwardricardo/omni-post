/**
 * @file ArchivePostsBatchUseCase.ts
 * @description Bulk-archive command — stamps archivedAt on every input post
 *              within a Unit-of-Work transaction. Skips posts that are
 *              soft-deleted or already archived (idempotent).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { AccountId, PostId, type PostRepository } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const MAX_BATCH_SIZE = 100;

/**
 * Input DTO for archiving a batch of posts.
 *
 * `callerAccountId` is the cross-tenant isolation gate (CWE-639). When
 * provided, the use case filters the input to only include posts the
 * caller actually owns before issuing the bulk archive — the rest are
 * silently skipped (counted under invalidIds is misleading; they are
 * "not yours" rather than "malformed", so they fall out of the result).
 * Optional for backward compat; real customer-facing routes pass it.
 */
export interface ArchivePostsBatchInput {
  postIds: string[];
  callerAccountId?: string;
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

    // Cross-tenant filter (CWE-639). Drop any postIds whose owning Project
    // does not belong to the caller's account before issuing the bulkArchive
    // — silent skip matches the bulk-update semantics for already-archived
    // / soft-deleted posts (no error, just zero affected for that subset).
    const ownedPostIds = input.callerAccountId
      ? await (async () => {
          const accountIdResult = AccountId.fromString(input.callerAccountId!);
          if (!accountIdResult.ok) return [];
          return this.postRepository.filterIdsByAccount(postIds, accountIdResult.value);
        })()
      : postIds;

    if (ownedPostIds.length === 0) {
      return ok({ archived: 0, invalidIds });
    }

    const doWork = async (): Promise<Result<ArchivePostsBatchOutput, UseCaseError>> => {
      const result = await this.postRepository.bulkArchive(ownedPostIds);
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
