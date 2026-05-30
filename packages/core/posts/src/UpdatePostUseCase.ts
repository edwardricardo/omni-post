/**
 * @file UpdatePostUseCase.ts
 * @description Orchestrates post content updates (body, title, summary, tags) via PostAggregate mutation, persisting within UoW and dispatching PostUpdated events.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  PostId,
  type PostAggregate,
  type PostRepository,
  type EventDispatcher,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { type PostDTO } from "./GetPostUseCase.js";

/**
 * Input DTO for updating a post.
 *
 * `expectedVersion` is the OCC token (Azure saga > 15-20). When provided, the
 * use case rejects the call with a CONFLICT error if the persisted version
 * has advanced past it — another writer committed in the meantime. When
 * omitted, the use case falls back to the repository-level OCC guard alone
 * (still rejects concurrent writes via the WHERE-clause check, but cannot
 * detect a slow caller working with stale read state).
 */
export interface UpdatePostInput {
  postId: string;
  body?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  expectedVersion?: number;
  /**
   * Account that owns the calling customer. When provided, the use case
   * verifies the post belongs to the caller's account before mutating —
   * cross-tenant updates are rejected as NOT_FOUND (404) per the anti-IDOR
   * canon (no enumeration via 403). Optional for backward compat with
   * pre-IDOR-fix callers + admin/internal use cases that bypass the check.
   */
  callerAccountId?: string;
}

/**
 * Update Post Use Case
 *
 * Updates an existing post's content. Only editable posts (draft or failed) can be updated.
 *
 * @example
 * const useCase = new UpdatePostUseCase(postRepository, eventDispatcher);
 * const result = await useCase.execute({
 *   postId: 'post-123',
 *   body: 'Updated content',
 *   title: 'New Title'
 * });
 */
export class UpdatePostUseCase implements UseCase<UpdatePostInput, PostDTO, UseCaseError> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: UpdatePostInput): Promise<Result<PostDTO, UseCaseError>> {
    // Validate post ID
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Cross-tenant ownership gate (CWE-639). Resolve the post's owner via
    // Project.accountId before loading the aggregate. A caller asking about
    // a post they do not own gets NOT_FOUND, not FORBIDDEN — return shape
    // matches the anti-IDOR canon used by saga admission (no enumeration).
    if (input.callerAccountId !== undefined) {
      const ownerAccountId = await this.postRepository.findOwnerAccountId(postIdResult.value);
      if (!ownerAccountId || ownerAccountId.value !== input.callerAccountId) {
        return err(new UseCaseError(`Post not found: ${input.postId}`, USE_CASE_ERRORS.NOT_FOUND));
      }
    }

    // Find the post
    const findResult = await this.postRepository.findById(postIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${input.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const post = findResult.value;

    // Check if post is editable
    if (!post.isEditable) {
      return err(
        new UseCaseError(
          `Post cannot be edited in current status: ${post.status.value}`,
          USE_CASE_ERRORS.FORBIDDEN
        )
      );
    }

    // OCC pre-check (Azure saga > 15-20). If the caller passed expectedVersion,
    // reject when the persisted version has advanced — another writer committed
    // between the caller's read and this update. Returns CONFLICT so the caller
    // (e.g., a saga retryable step) can re-read and retry against fresh state.
    if (input.expectedVersion !== undefined && post.version !== input.expectedVersion) {
      return err(
        new UseCaseError(
          `Post version conflict: expected ${input.expectedVersion}, found ${post.version}`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // Update content if provided
    if (input.body || input.title || input.summary || input.tags) {
      const updateResult = post.updateContent({
        ...(input.body && { body: input.body }),
        ...(input.title && { title: input.title }),
        ...(input.summary && { summary: input.summary }),
        ...(input.tags && { tags: input.tags }),
      });

      if (!updateResult.ok) {
        return err(
          new UseCaseError(
            updateResult.error.message,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            updateResult.error
          )
        );
      }
    }

    // Persist changes and dispatch domain events
    const persistResult = await this.persistAndDispatch(post);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    // Return updated DTO
    return ok({
      id: post.id.value,
      projectId: post.projectId.value,
      body: post.content.body,
      ...(post.content.title && { title: post.content.title }),
      ...(post.content.summary && { summary: post.content.summary }),
      tags: [...post.content.tags],
      locale: post.content.locale,
      status: post.status.value,
      ...(post.scheduledAt && { scheduledAt: post.scheduledAt.dateTime }),
      ...(post.publishedAt && { publishedAt: post.publishedAt }),
      mediaCount: post.media.length,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    });
  }

  /**
   * @method persistAndDispatch
   * @description Saves the aggregate and dispatches domain events, optionally within a UoW transaction.
   * @param post - The post aggregate to persist
   * @returns Result indicating success or failure
   */
  private async persistAndDispatch(post: PostAggregate): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.postRepository.save(post);
      if (!saveResult.ok) {
        return err(
          new UseCaseError("Failed to save post", USE_CASE_ERRORS.INTERNAL_ERROR, saveResult.error)
        );
      }

      const events = post.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        post.clearDomainEvents();
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
