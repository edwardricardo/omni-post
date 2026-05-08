/**
 * @file HardDeletePostsBatchUseCase.ts
 * @description Bulk-hard-delete command — physically removes posts (cascades
 *              to contents, media, publishLogs, etc. via Prisma relations).
 *              Irreversible — only use from explicit trash-empty UX or admin.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { PostId, type PostRepository } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

const MAX_BATCH_SIZE = 100;

/**
 * Input DTO for hard-deleting a batch of posts.
 */
export interface HardDeletePostsBatchInput {
  postIds: string[];
}

/**
 * Output DTO — count of rows physically removed.
 */
export interface HardDeletePostsBatchOutput {
  deleted: number;
  /** Subset of input ids rejected for being malformed UUIDs. */
  invalidIds: string[];
}

/**
 * Hard Delete Posts Batch Use Case
 *
 * Validates every input id, then issues a single Prisma deleteMany inside a
 * transaction. Cascades to dependent rows per schema (contents, media,
 * publishLogs, comments, etc.). Use from "Empty trash" UX or admin tooling
 * only — soft-delete is the default delete path for end-users.
 */
export class HardDeletePostsBatchUseCase implements UseCase<
  HardDeletePostsBatchInput,
  HardDeletePostsBatchOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: HardDeletePostsBatchInput
  ): Promise<Result<HardDeletePostsBatchOutput, UseCaseError>> {
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
      return ok({ deleted: 0, invalidIds });
    }

    const doWork = async (): Promise<Result<HardDeletePostsBatchOutput, UseCaseError>> => {
      const result = await this.postRepository.bulkHardDelete(postIds);
      if (!result.ok) {
        return err(
          new UseCaseError(
            `Bulk hard-delete failed: ${result.error.message}`,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            result.error
          )
        );
      }
      return ok({ deleted: result.value, invalidIds });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<HardDeletePostsBatchOutput, UseCaseError> = ok({
          deleted: 0,
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
          "Bulk hard-delete transaction failed",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
