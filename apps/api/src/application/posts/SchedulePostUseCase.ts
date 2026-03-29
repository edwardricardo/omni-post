/**
 * Application Layer - Schedule Post Use Case
 *
 * Transitions a post from DRAFT to SCHEDULED status using the domain aggregate
 * method PostAggregate.schedule(). Validates channel existence, persists the
 * state change, and dispatches domain events (PostScheduled).
 *
 * Part of P2-ARCH-1: Migrate postRoutes Prisma direct calls to use cases.
 *
 * @module application/posts/SchedulePostUseCase
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  PostId,
  ChannelId,
  type PostRepository,
  type EventDispatcher,
  type ChannelRepository,
} from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { incrementPostPublished } from "../../metrics/businessMetrics.js";

/**
 * Input DTO for scheduling a post.
 *
 * @property postId - UUID of the post to schedule.
 * @property channelIds - UUIDs of channels where the post will be published.
 * @property scheduledFor - ISO 8601 datetime string for the scheduled publication time.
 * @property timezone - Optional IANA timezone identifier (defaults to "UTC").
 */
export interface SchedulePostInput {
  postId: string;
  channelIds: string[];
  scheduledFor: string;
  timezone?: string;
}

/**
 * Output DTO for the scheduled post.
 *
 * @property id - The post UUID.
 * @property status - Will always be "SCHEDULED" on success.
 * @property scheduledFor - The ISO 8601 datetime the post is scheduled for.
 * @property channelIds - The channels where the post will be published.
 */
export interface SchedulePostOutput {
  id: string;
  status: string;
  scheduledFor: string;
  channelIds: string[];
}

/**
 * Schedule Post Use Case
 *
 * Transitions a draft post to SCHEDULED status. Uses the PostAggregate.schedule()
 * domain method which validates state transitions (only DRAFT posts can be
 * scheduled) and enforces business invariants (scheduled time must be in the
 * future, at least 5 minutes from now, at most 1 year ahead).
 *
 * The use case also verifies that all provided channel IDs exist, so invalid
 * channel references are caught before persisting.
 *
 * @param postRepository - Repository port for loading/saving post aggregates.
 * @param eventDispatcher - Dispatcher for domain events (PostScheduled).
 * @param channelRepository - Repository port for verifying channel existence.
 *
 * @throws UseCaseError with code VALIDATION_FAILED for invalid post ID or
 *   scheduled time.
 * @throws UseCaseError with code NOT_FOUND when the post or a channel does not
 *   exist.
 * @throws UseCaseError with code FORBIDDEN when the post is not in a
 *   schedulable state.
 *
 * @example
 * const useCase = new SchedulePostUseCase(postRepo, dispatcher, channelRepo);
 * const result = await useCase.execute({
 *   postId: "550e8400-e29b-41d4-a716-446655440000",
 *   channelIds: ["chan-1", "chan-2"],
 *   scheduledFor: "2026-04-01T12:00:00Z",
 * });
 * if (result.ok) {
 *   console.log(result.value.status); // "SCHEDULED"
 * }
 */
export class SchedulePostUseCase implements UseCase<
  SchedulePostInput,
  SchedulePostOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly channelRepository: ChannelRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: SchedulePostInput): Promise<Result<SchedulePostOutput, UseCaseError>> {
    // 1. Validate post ID format
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // 2. Validate channel IDs are non-empty
    if (input.channelIds.length === 0) {
      return err(
        new UseCaseError(
          "At least one channel must be specified for scheduling",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // 3. Parse scheduled time
    const scheduledDate = new Date(input.scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return err(
        new UseCaseError(
          `Invalid scheduled time: ${input.scheduledFor}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // 4. Load the post aggregate
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

    // 5. Verify all channels exist
    for (const channelId of input.channelIds) {
      const channelIdResult = ChannelId.fromString(channelId);
      if (!channelIdResult.ok) {
        return err(
          new UseCaseError(`Invalid channel ID: ${channelId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
        );
      }
      const channelResult = await this.channelRepository.findById(channelIdResult.value);
      if (!channelResult.ok) {
        return err(new UseCaseError(`Channel not found: ${channelId}`, USE_CASE_ERRORS.NOT_FOUND));
      }
    }

    // 6. Invoke domain method to schedule
    const scheduleResult = post.schedule(
      scheduledDate,
      ...(input.timezone !== undefined ? [input.timezone] : [])
    );
    if (!scheduleResult.ok) {
      // Map domain errors to use case errors
      const domainError = scheduleResult.error;
      const isForbidden = domainError.name === "InvalidStateTransitionError";
      return err(
        new UseCaseError(
          domainError.message,
          isForbidden ? USE_CASE_ERRORS.FORBIDDEN : USE_CASE_ERRORS.VALIDATION_FAILED,
          domainError
        )
      );
    }

    // 7. Persist the aggregate and dispatch domain events
    const doWork = async (): Promise<Result<SchedulePostOutput, UseCaseError>> => {
      const saveResult = await this.postRepository.save(post);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save scheduled post",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      // Dispatch domain events (PostScheduled)
      const events = post.domainEvents;
      if (events.length > 0) {
        await this.eventDispatcher.dispatchAll([...events]);
        post.clearDomainEvents();
      }

      // Business metric: post scheduled successfully
      incrementPostPublished();

      return ok({
        id: post.id.value,
        status: post.status.value,
        scheduledFor: input.scheduledFor,
        channelIds: input.channelIds,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SchedulePostOutput, UseCaseError> = err(
          new UseCaseError("Transaction did not complete", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save scheduled post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
