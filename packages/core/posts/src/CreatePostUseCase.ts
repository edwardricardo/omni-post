/**
 * @file CreatePostUseCase.ts
 * @description Orchestrates post creation by constructing the PostAggregate, persisting via repository within UoW, and dispatching PostCreated events.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  PostAggregate,
  ProjectId,
  type PostRepository,
  type EventDispatcher,
  type ContentLocale,
} from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

/**
 * A single media item to attach to the post after creation.
 * Mirrors `CreatePostMedia` from `PostCreationPort` — kept local so the
 * application use case does not take a hard dependency on the ports package.
 */
export interface CreatePostMediaItem {
  readonly url: string;
  readonly type: MediaType;
  readonly width?: number;
  readonly height?: number;
  readonly alt?: string;
}

/**
 * Input DTO for creating a post
 */
export interface CreatePostInput {
  projectId: string;
  body: string;
  title?: string;
  summary?: string;
  tags?: string[];
  locale?: ContentLocale;
  scheduledAt?: Date;
  /**
   * Optional media items to attach via `PostAggregate.addMedia()` immediately
   * after creation while the post is still DRAFT. Each item is validated by the
   * domain aggregate — a failure returns `VALIDATION_FAILED` early.
   */
  media?: ReadonlyArray<CreatePostMediaItem>;
  /**
   * Cross-tenant ownership gate (CWE-639 create-in-foreign-project). When set,
   * the use case resolves the target project's owner via `ProjectRepository`
   * and rejects a foreign caller with NOT_FOUND (anti-enumeration) before any
   * write. Optional for backward compat with system/admin paths (recurrence
   * fan-out, bulk-scheduling) whose `projectId` is already owner-validated
   * upstream and therefore legitimately omit it.
   */
  callerAccountId?: string;
}

/**
 * Output DTO for created post
 */
export interface CreatePostOutput {
  id: string;
  projectId: string;
  body: string;
  title?: string;
  tags: string[];
  locale: string;
  status: string;
  scheduledAt?: Date;
  createdAt: Date;
}

/**
 * Create Post Use Case
 *
 * Creates a new post in the system. Optionally schedules it for future publishing.
 *
 * @example
 * const useCase = new CreatePostUseCase(postRepository, eventDispatcher, businessMetrics);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   body: 'Hello world!',
 *   title: 'My First Post'
 * });
 */
export class CreatePostUseCase implements UseCase<CreatePostInput, CreatePostOutput, UseCaseError> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly businessMetrics: BusinessMetricsPort,
    private readonly projectRepository?: ProjectRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: CreatePostInput): Promise<Result<CreatePostOutput, UseCaseError>> {
    // Validate project ID
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Cross-tenant ownership gate (CWE-639 create-in-foreign-project). Resolve
    // the target project's owning accountId and reject a caller who does not own
    // it with NOT_FOUND, not FORBIDDEN — same anti-enumeration shape as a missing
    // project, consistent with the read/delete gates added for IDOR-POSTS.
    if (input.callerAccountId !== undefined && this.projectRepository) {
      const ownerAccountId = await this.projectRepository.findOwnerAccountId(projectIdResult.value);
      if (!ownerAccountId || ownerAccountId.value !== input.callerAccountId) {
        return err(
          new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

    // Create the post aggregate
    const createResult = PostAggregate.create({
      projectId: projectIdResult.value,
      body: input.body,
      ...(input.title && { title: input.title }),
      ...(input.summary && { summary: input.summary }),
      ...(input.tags && { tags: input.tags }),
      ...(input.locale && { locale: input.locale }),
      ...(input.scheduledAt && { scheduledAt: input.scheduledAt }),
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const post = createResult.value;

    // Attach media items while the post is still DRAFT and editable.
    // addMedia validates each item via the domain aggregate — an invalid item
    // (bad URL, unsupported type) returns VALIDATION_FAILED early before any
    // DB write.
    for (const m of input.media ?? []) {
      const mediaResult = post.addMedia({
        type: m.type,
        url: m.url,
        ...(m.width !== undefined && { width: m.width }),
        ...(m.height !== undefined && { height: m.height }),
        ...(m.alt !== undefined && { altText: m.alt }),
      });
      if (!mediaResult.ok) {
        return err(
          new UseCaseError(
            mediaResult.error.message,
            USE_CASE_ERRORS.VALIDATION_FAILED,
            mediaResult.error
          )
        );
      }
    }

    // Persist the post and dispatch domain events
    const persistResult = await this.persistAndDispatch(post);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    // Business metric: post successfully persisted
    this.businessMetrics.incrementPostCreated();

    // Return output DTO
    return ok({
      id: post.id.value,
      projectId: post.projectId.value,
      body: post.content.body,
      ...(post.content.title && { title: post.content.title }),
      tags: [...post.content.tags],
      locale: post.content.locale,
      status: post.status.value,
      ...(post.scheduledAt && { scheduledAt: post.scheduledAt.dateTime }),
      createdAt: post.createdAt,
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
