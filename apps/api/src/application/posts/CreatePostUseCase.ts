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

    // Persist the post and dispatch domain events atomically
    const persistAndDispatch = async () => {
      const saveResult = await this.postRepository.save(post);
      if (!saveResult.ok) {
        throw new UseCaseError(
          "Failed to save post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        );
      }

      const events = post.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        post.clearDomainEvents();
      }
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(persistAndDispatch);
      } else {
        await persistAndDispatch();
      }
    } catch (error) {
      if (error instanceof UseCaseError) {
        return err(error);
      }
      return err(
        new UseCaseError(
          "Failed to save post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
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
}
