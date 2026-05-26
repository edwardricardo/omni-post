/**
 * @file SetFirstCommentUseCase.ts
 * @description Application use case for setting or updating the first comment
 *   that will be auto-published after a post goes live on a platform.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { FirstCommentRepository } from "@core/domain/repositories/FirstCommentRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { randomUUID } from "node:crypto";

/**
 * Input DTO for setting a first comment
 */
export interface SetFirstCommentCommand {
  postId: string;
  body: string;
}

/**
 * Output DTO for the set operation
 */
export interface SetFirstCommentOutput {
  id: string;
  postId: string;
  body: string;
  status: string;
}

/**
 * @class SetFirstCommentUseCase
 * @description Sets or updates the first comment for a post.
 *   Uses upsert semantics (postId has a unique constraint).
 */
export class SetFirstCommentUseCase implements UseCase<
  SetFirstCommentCommand,
  SetFirstCommentOutput,
  UseCaseError
> {
  constructor(
    private readonly firstCommentRepo: FirstCommentRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Sets or updates the first comment body for a given post.
   * @param command - The post ID and comment body
   * @returns Result containing the persisted first comment data
   */
  async execute(
    command: SetFirstCommentCommand
  ): Promise<Result<SetFirstCommentOutput, UseCaseError>> {
    if (!command.body.trim()) {
      return err(
        new UseCaseError("First comment body cannot be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const doWork = async (): Promise<Result<SetFirstCommentOutput, UseCaseError>> => {
      const saveResult = await this.firstCommentRepo.save({
        id: randomUUID(),
        postId: command.postId,
        body: command.body,
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            saveResult.error.message,
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      const saved = saveResult.value;
      return ok({
        id: saved.id,
        postId: saved.postId,
        body: saved.body,
        status: saved.status,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SetFirstCommentOutput, UseCaseError> = ok({
          id: "",
          postId: "",
          body: "",
          status: "",
        }) as Result<SetFirstCommentOutput, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to set first comment",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
