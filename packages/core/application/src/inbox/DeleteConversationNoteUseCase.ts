/**
 * @file DeleteConversationNoteUseCase.ts
 * @description Soft-deletes a conversation note. Only the original author can delete.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ConversationNoteRepository } from "@core/domain/repositories/ConversationNoteRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for deleting a conversation note.
 */
export interface DeleteConversationNoteInput {
  noteId: string;
  authorId: string;
}

/**
 * @class DeleteConversationNoteUseCase
 * @description Loads the note, verifies author ownership, and soft-deletes it.
 */
export class DeleteConversationNoteUseCase implements UseCase<
  DeleteConversationNoteInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly noteRepo: ConversationNoteRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates ownership and soft-deletes the note.
   * @param input - Contains noteId and authorId
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: DeleteConversationNoteInput): Promise<Result<void, UseCaseError>> {
    // 1. Load note
    const findResult = await this.noteRepo.findById(input.noteId);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Note not found: ${input.noteId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const note = findResult.value;

    // 2. Verify author ownership
    if (note.authorId !== input.authorId) {
      return err(
        new UseCaseError("Only the note author can delete this note", USE_CASE_ERRORS.FORBIDDEN)
      );
    }

    // 3. Soft-delete
    note.softDelete();

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const saveResult = await this.noteRepo.save(note);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to delete conversation note",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
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
          "Failed to persist note deletion",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
