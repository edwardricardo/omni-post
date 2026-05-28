/**
 * @file DuplicatePostsBatchUseCase.ts
 * @description Bulk-duplicate command — clones every source post into a new
 *              DRAFT aggregate within the same project. Copies content
 *              (body/title/summary/tags/locale) plus media attachments,
 *              then saves and dispatches PostCreated events per new post.
 *              Skips sources that are not found or soft-deleted.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  AccountId,
  PostAggregate,
  PostId,
  type PostRepository,
  type EventDispatcher,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const MAX_BATCH_SIZE = 50;

/**
 * Input DTO for duplicating a batch of posts.
 *
 * `callerAccountId` enforces cross-tenant isolation (CWE-639) — sources
 * not owned by the caller are filtered out before the read+clone loop
 * runs, so duplication can never copy content from another tenant.
 */
export interface DuplicatePostsBatchInput {
  postIds: string[];
  callerAccountId?: string;
}

/**
 * Output DTO for the bulk-duplicate operation.
 */
export interface DuplicatePostsBatchOutput {
  /** Original-id → new-id pairs for every successfully duplicated post. */
  duplicates: Array<{ sourceId: string; newId: string }>;
  /** Source ids that were rejected for being malformed UUIDs. */
  invalidIds: string[];
  /** Source ids that could not be located (deleted or never existed). */
  notFoundIds: string[];
}

/**
 * Duplicate Posts Batch Use Case
 *
 * Loads each source aggregate, builds a fresh DRAFT aggregate with the same
 * content + media, and persists it inside a single UoW transaction. The
 * lower batch cap (50 vs 100 for archive/delete) reflects the higher cost
 * per item — each source requires a read + a write rather than a single
 * updateMany.
 *
 * Domain events: each duplicate raises PostCreated (and PostMediaAdded per
 * copied media), dispatched after save so subscribers see the canonical
 * aggregate-saved event flow.
 */
export class DuplicatePostsBatchUseCase implements UseCase<
  DuplicatePostsBatchInput,
  DuplicatePostsBatchOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: DuplicatePostsBatchInput
  ): Promise<Result<DuplicatePostsBatchOutput, UseCaseError>> {
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

    const validIds: PostId[] = [];
    const invalidIds: string[] = [];
    for (const raw of input.postIds) {
      const parsed = PostId.fromString(raw);
      if (parsed.ok) {
        validIds.push(parsed.value);
      } else {
        invalidIds.push(raw);
      }
    }

    // Cross-tenant filter (CWE-639). Drop ids not owned by caller — these
    // become "not found" from the caller's perspective rather than leaking
    // existence by attempting and failing later.
    const ownedIds = input.callerAccountId
      ? await (async () => {
          const accountIdResult = AccountId.fromString(input.callerAccountId!);
          if (!accountIdResult.ok) return [];
          return this.postRepository.filterIdsByAccount(validIds, accountIdResult.value);
        })()
      : validIds;

    const doWork = async (): Promise<Result<DuplicatePostsBatchOutput, UseCaseError>> => {
      const duplicates: Array<{ sourceId: string; newId: string }> = [];
      const notFoundIds: string[] = [];

      // Anything dropped by the cross-tenant filter is reported as not-found
      // (canon: do not leak existence of cross-tenant posts).
      const ownedIdSet = new Set(ownedIds.map((id) => id.value));
      for (const id of validIds) {
        if (!ownedIdSet.has(id.value)) {
          notFoundIds.push(id.value);
        }
      }

      for (const sourceId of ownedIds) {
        const findResult = await this.postRepository.findById(sourceId);
        if (!findResult.ok) {
          notFoundIds.push(sourceId.value);
          continue;
        }

        const source = findResult.value;
        const cloneResult = PostAggregate.create({
          projectId: source.projectId,
          body: source.content.body,
          ...(source.content.title !== undefined && { title: source.content.title }),
          ...(source.content.summary !== undefined && { summary: source.content.summary }),
          tags: [...source.content.tags],
          locale: source.content.locale,
        });

        if (!cloneResult.ok) {
          return err(
            new UseCaseError(
              `Failed to clone post ${sourceId.value}: ${cloneResult.error.message}`,
              USE_CASE_ERRORS.INTERNAL_ERROR,
              cloneResult.error
            )
          );
        }

        const clone = cloneResult.value;

        for (const media of source.media) {
          const addResult = clone.addMedia({
            type: media.type,
            url: media.url,
            ...(media.width !== undefined && { width: media.width }),
            ...(media.height !== undefined && { height: media.height }),
            ...(media.durationMs !== undefined && { durationMs: media.durationMs }),
            ...(media.fileSizeBytes !== undefined && { fileSizeBytes: media.fileSizeBytes }),
            ...(media.altText !== undefined && { altText: media.altText }),
            ...(media.hash !== undefined && { hash: media.hash }),
          });
          if (!addResult.ok) {
            return err(
              new UseCaseError(
                `Failed to copy media for post ${sourceId.value}`,
                USE_CASE_ERRORS.INTERNAL_ERROR,
                addResult.error
              )
            );
          }
        }

        const saveResult = await this.postRepository.save(clone);
        if (!saveResult.ok) {
          return err(
            new UseCaseError(
              `Failed to save duplicated post for ${sourceId.value}: ${saveResult.error.message}`,
              USE_CASE_ERRORS.INTERNAL_ERROR,
              saveResult.error
            )
          );
        }

        const events = clone.domainEvents;
        if (events.length > 0) {
          await this.eventDispatcher.dispatchAll([...events]);
          clone.clearDomainEvents();
        }

        duplicates.push({ sourceId: sourceId.value, newId: clone.id.value });
      }

      return ok({ duplicates, invalidIds, notFoundIds });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<DuplicatePostsBatchOutput, UseCaseError> = ok({
          duplicates: [],
          invalidIds,
          notFoundIds: [],
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
          "Bulk duplicate transaction failed",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
