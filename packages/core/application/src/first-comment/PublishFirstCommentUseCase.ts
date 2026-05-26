/**
 * @file PublishFirstCommentUseCase.ts
 * @description Application use case that executes the actual publishing of a
 *   first comment via a provider adapter. Called by the worker after the post
 *   has been successfully published on a platform.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { FirstCommentRepository } from "@core/domain/repositories/FirstCommentRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Provider adapter interface for posting replies.
 * Intentionally minimal to avoid coupling to the full provider adapter.
 */
export interface FirstCommentProviderPort {
  /**
   * @method postReply
   * @description Posts a reply (comment) on a published post via the provider API.
   * @param platformPostId - The platform-specific post ID to reply to
   * @param body - The comment text
   * @returns Result containing the platform comment ID on success
   */
  postReply(platformPostId: string, body: string): Promise<Result<string, Error>>;
}

/**
 * Input DTO for publishing a first comment
 */
export interface PublishFirstCommentCommand {
  postId: string;
  platformPostId: string;
  provider: FirstCommentProviderPort;
}

/**
 * Output DTO for the publish result
 */
export interface PublishFirstCommentOutput {
  postId: string;
  providerCommentId: string;
  status: string;
}

/**
 * @class PublishFirstCommentUseCase
 * @description Publishes the first comment for a post via the given provider adapter.
 *   Looks up the pending first comment, calls the provider to post the reply,
 *   then updates the status accordingly.
 */
export class PublishFirstCommentUseCase implements UseCase<
  PublishFirstCommentCommand,
  PublishFirstCommentOutput,
  UseCaseError
> {
  constructor(
    private readonly firstCommentRepo: FirstCommentRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Publishes the first comment via the provider adapter and updates status.
   * @param command - Contains postId, platformPostId, and provider adapter
   * @returns Result containing the publish result or error
   */
  async execute(
    command: PublishFirstCommentCommand
  ): Promise<Result<PublishFirstCommentOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<PublishFirstCommentOutput, UseCaseError>> => {
      // Fetch the pending first comment
      const findResult = await this.firstCommentRepo.findByPostId(command.postId);

      if (!findResult.ok) {
        return err(
          new UseCaseError(
            findResult.error.message,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            findResult.error
          )
        );
      }

      const firstComment = findResult.value;
      if (!firstComment) {
        return err(
          new UseCaseError(
            `No first comment found for post ${command.postId}`,
            USE_CASE_ERRORS.NOT_FOUND
          )
        );
      }

      if (firstComment.status === "PUBLISHED") {
        return err(
          new UseCaseError(
            `First comment for post ${command.postId} is already published`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

      // Call the provider to post the reply
      const replyResult = await command.provider.postReply(
        command.platformPostId,
        firstComment.body
      );

      if (!replyResult.ok) {
        // Update status to FAILED with error message
        await this.firstCommentRepo.updateStatus(command.postId, "FAILED", {
          error: replyResult.error.message,
        });

        return err(
          new UseCaseError(
            `Failed to publish first comment: ${replyResult.error.message}`,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            replyResult.error
          )
        );
      }

      const providerCommentId = replyResult.value;

      // Update status to PUBLISHED
      await this.firstCommentRepo.updateStatus(command.postId, "PUBLISHED", {
        providerCommentId,
      });

      return ok({
        postId: command.postId,
        providerCommentId,
        status: "PUBLISHED",
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<PublishFirstCommentOutput, UseCaseError> = ok({
          postId: "",
          providerCommentId: "",
          status: "",
        }) as Result<PublishFirstCommentOutput, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to publish first comment",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
