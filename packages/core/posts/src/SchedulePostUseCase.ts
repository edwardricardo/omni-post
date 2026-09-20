/**
 * @file SchedulePostUseCase.ts
 * @description Orchestrates post scheduling by transitioning DRAFT to SCHEDULED via PostAggregate.schedule(), validating channels, persisting within UoW, and dispatching PostScheduled events.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  PostId,
  ChannelId,
  type DomainEvent,
  type PostRepository,
  type EventDispatcher,
  type ChannelRepository,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";

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
 * const useCase = new SchedulePostUseCase(postRepo, dispatcher, channelRepo, businessMetrics);
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
    private readonly businessMetrics: BusinessMetricsPort,
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

    // 5. Verify all channels exist. The parsed identities are KEPT: they are the
    //    validated set this post is intended for, and step 7 records them.
    const channelIds: ChannelId[] = [];
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
      channelIds.push(channelIdResult.value);
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

    // 7. Persist the aggregate, declare its target set, and dispatch domain events.
    //
    // THE SEQUENCE IS FORCED FROM BOTH ENDS. It is written out because each step is
    // there to satisfy a refusal that already exists, and re-ordering any two of them
    // trips one of those refusals rather than merely changing style:
    //
    //   (1) the FULL save runs FIRST. It writes the post row, `scheduledAt`, the content
    //       and the media — none of which the narrow save writes — and it REFUSES an
    //       aggregate that already owes a publication write. So it cannot run after the
    //       declaration.
    //   (2) the events are CAPTURED and CLEARED next, and dispatched by nobody yet. The
    //       outbox already holds them from (1), and both adapters hand
    //       `aggregate.domainEvents` to the outbox writer, which inserts keyed on the
    //       event id with no `skipDuplicates`. Leaving them on the aggregate makes step
    //       (4) insert the same ids a second time: a P2002 that aborts this whole
    //       transaction, not a duplicate row.
    //   (3) the targets are declared AFTER the full save, for the reason in (1).
    //       `declarePublicationTargets` emits no domain event, so this step adds nothing
    //       to the outbox and step (2) stays sufficient.
    //   (4) the NARROW save writes the records — it is the only writer of them — and
    //       carries no events, so its own edit tripwire is satisfied by construction.
    //   (5) the DISPATCH happens after the transaction COMMITS, outside the seam.
    //
    // Why (5) is outside, and why it was not before: `dispatchAll` runs the in-process
    // handlers and then publishes a BullMQ batch — an external call, which
    // ARCHITECTURE_CANON §UoW Rules keeps out of a transaction. Inside, it told consumers
    // the post was scheduled while the transaction was still open, and steps (3) and (4)
    // can both still fail — so a narrow-save failure or a declaration conflict would roll
    // back a schedule the world had already been told about. Nothing is lost by waiting:
    // the events are in the OUTBOX from step (1), so a crash between the commit and the
    // dispatch is exactly what the outbox relay exists to recover.
    let pendingEvents: DomainEvent[] = [];
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

      // Captured, not dispatched: the outbox holds them already, and the dispatch waits
      // for the commit. Cleared so the narrow save below carries none of them.
      pendingEvents = [...post.domainEvents];
      post.clearDomainEvents();

      // REC-1: the channels validated above are the system's answer to "where was this
      // post meant to go", so they are PERSISTED rather than only echoed in the DTO.
      const declared = post.declarePublicationTargets(channelIds);
      if (!declared.ok) {
        return err(
          new UseCaseError(declared.error.message, USE_CASE_ERRORS.CONFLICT, declared.error)
        );
      }

      const recordsSaved = await this.postRepository.savePublication(post);
      if (!recordsSaved.ok) {
        return err(
          new UseCaseError(
            "Failed to save the scheduled post's publication targets",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            recordsSaved.error
          )
        );
      }

      // Business metric: post scheduled successfully
      this.businessMetrics.incrementPostPublished();

      return ok({
        id: post.id.value,
        status: post.status.value,
        scheduledFor: input.scheduledFor,
        channelIds: input.channelIds,
      });
    };

    try {
      // The Result-aware seam: an `err` returned from `doWork` ROLLS BACK and comes
      // back unchanged. The throw-based form stored that `err` in a variable and let
      // the callback RESOLVE, so the unit of work saw a success and committed — and
      // this save is multi-statement (post row, content, media, outbox), so a failure
      // raised after the first statement committed a partial write (ADR-0023).
      const result = this.unitOfWork
        ? await this.unitOfWork.executeResultInTransaction(doWork)
        : await doWork();

      // Step (5). Only after the transaction has closed, and only when it COMMITTED: an
      // `err` rolled the schedule back, so there is nothing to tell anyone about.
      if (result.ok && pendingEvents.length > 0) {
        await this.eventDispatcher.dispatchAll(pendingEvents);
      }

      return result;
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
