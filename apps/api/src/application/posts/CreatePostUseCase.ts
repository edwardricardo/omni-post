/**
 * Application Layer - Create Post Use Case
 *
 * Part of Sprint 8: DDD Architecture Implementation
 * Handles the creation of new posts.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  PostAggregate,
  ProjectId,
  type PostRepository,
  type EventDispatcher,
  type ContentLocale,
} from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { incrementPostCreated } from "../../metrics/businessMetrics.js";

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
 * const useCase = new CreatePostUseCase(postRepository, eventDispatcher);
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

    // Persist the post and dispatch domain events
    const persistResult = await this.persistAndDispatch(post);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    // Business metric: post successfully persisted
    incrementPostCreated();

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
