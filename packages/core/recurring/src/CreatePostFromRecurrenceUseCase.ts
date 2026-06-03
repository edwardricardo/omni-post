/**
 * @file CreatePostFromRecurrenceUseCase.ts
 * @description Creates and schedules a new Post from a RecurringPost
 *              template. Loads the source template Post, clones its
 *              content + media into a fresh DRAFT, then transitions to
 *              SCHEDULED via SchedulePostUseCase using the recurrence's
 *              channels + dueAt as the scheduledFor.
 *
 *              Only `EXACT` content variation is wired. `ROTATED` (variant
 *              library) and `AI_GENERATED` (AI prompt) return a
 *              NotImplemented error.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  PostAggregate,
  PostId,
  ProjectId,
  type PostRepository,
  type EventDispatcher,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { PostCreationPort } from "@ports/core";

export interface CreatePostFromRecurrenceInput {
  /** RecurringPost ID — used only for log breadcrumbs / tracing. */
  recurringPostId: string;
  /** Template Post ID to clone from. */
  templatePostId: string;
  /** Project the new Post belongs to (must match template's project). */
  projectId: string;
  /** Channel IDs to schedule the new Post against. */
  channels: string[];
  /** When the new Post should publish (recurrence's intended fire time). */
  dueAt: Date;
  /** Content variation strategy — only `EXACT` is currently supported. */
  contentVariation: string;
}

export interface CreatePostFromRecurrenceOutput {
  /** New Post ID — useful for logging + downstream lookups. */
  postId: string;
  /** True when the new Post is now in SCHEDULED status. */
  scheduled: boolean;
}

/**
 * Create-Post-From-Recurrence Use Case.
 *
 * Composition of:
 * 1. PostAggregate.create — clone content from template
 * 2. PostAggregate.addMedia — copy each media attachment
 * 3. postRepository.save — persist the new DRAFT Post
 * 4. SchedulePostUseCase.execute — transition DRAFT → SCHEDULED + assign channels
 *
 * Both saves run inside the injected UoW transaction so the new Post
 * is either fully scheduled or not visible at all.
 */
export class CreatePostFromRecurrenceUseCase implements UseCase<
  CreatePostFromRecurrenceInput,
  CreatePostFromRecurrenceOutput,
  UseCaseError
> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly postCreation: PostCreationPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: CreatePostFromRecurrenceInput
  ): Promise<Result<CreatePostFromRecurrenceOutput, UseCaseError>> {
    if (input.contentVariation !== "EXACT") {
      return err(
        new UseCaseError(
          `Content variation "${input.contentVariation}" not yet implemented`,
          USE_CASE_ERRORS.NOT_IMPLEMENTED
        )
      );
    }

    if (input.channels.length === 0) {
      return err(
        new UseCaseError(
          "RecurringPost must have at least one channel",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const templateIdResult = PostId.fromString(input.templatePostId);
    if (!templateIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid template post ID: ${input.templatePostId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const doWork = async (): Promise<Result<CreatePostFromRecurrenceOutput, UseCaseError>> => {
      // 1. Load template
      const templateResult = await this.postRepository.findById(templateIdResult.value);
      if (!templateResult.ok) {
        return err(
          new UseCaseError(
            `Template post not found: ${input.templatePostId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            templateResult.error
          )
        );
      }
      const template = templateResult.value;

      // 2. Build clone aggregate
      const cloneResult = PostAggregate.create({
        projectId: projectIdResult.value,
        body: template.content.body,
        ...(template.content.title !== undefined && { title: template.content.title }),
        ...(template.content.summary !== undefined && { summary: template.content.summary }),
        tags: [...template.content.tags],
        locale: template.content.locale,
      });
      if (!cloneResult.ok) {
        return err(
          new UseCaseError(
            `Failed to clone template: ${cloneResult.error.message}`,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            cloneResult.error
          )
        );
      }
      const clone = cloneResult.value;

      // 3. Copy media attachments
      for (const media of template.media) {
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
              `Failed to copy media on clone: ${addResult.error.message}`,
              USE_CASE_ERRORS.INTERNAL_ERROR,
              addResult.error
            )
          );
        }
      }

      // 4. Persist DRAFT + dispatch creation events
      const saveResult = await this.postRepository.save(clone);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            `Failed to save clone: ${saveResult.error.message}`,
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

      // 5. Transition DRAFT → SCHEDULED + assign channels
      const scheduleResult = await this.postCreation.schedulePost({
        postId: clone.id.value,
        channelIds: input.channels,
        scheduledFor: input.dueAt.toISOString(),
      });
      if (!scheduleResult.ok) {
        return err(
          new UseCaseError(
            `Failed to schedule clone: ${scheduleResult.error.message}`,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            scheduleResult.error
          )
        );
      }

      return ok({ postId: clone.id.value, scheduled: true });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreatePostFromRecurrenceOutput, UseCaseError> = ok({
          postId: "",
          scheduled: false,
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
          "Create-from-recurrence transaction failed",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
