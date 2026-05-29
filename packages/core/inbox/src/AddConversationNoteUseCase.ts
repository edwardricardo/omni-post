/**
 * @file AddConversationNoteUseCase.ts
 * @description Creates a new internal note on a social inbox conversation.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { ConversationNoteRepository } from "@core/domain/repositories/ConversationNoteRepository.js";
import { ConversationNote } from "@core/domain/entities/ConversationNote.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { MentionTrackingPort } from "@ports/core";
import { MENTION_CONTEXT } from "@core/domain/value-objects/MentionContext.js";

/**
 * Input DTO for adding a conversation note.
 */
export interface AddConversationNoteInput {
  conversationId: string;
  authorId: string;
  authorName: string;
  accountId: string;
  body: string;
}

/**
 * Output DTO containing the created note's identifier.
 */
export interface AddConversationNoteOutput {
  id: string;
}

/**
 * @class AddConversationNoteUseCase
 * @description Validates input, creates a ConversationNote entity, and persists it.
 */
export class AddConversationNoteUseCase implements UseCase<
  AddConversationNoteInput,
  AddConversationNoteOutput,
  UseCaseError
> {
  constructor(
    private readonly noteRepo: ConversationNoteRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly mentionNotifier?: MentionTrackingPort
  ) {}

  /**
   * @method execute
   * @description Creates and persists a new conversation note.
   * @param input - Contains conversationId, authorId, and body
   * @returns Result containing the note ID on success, UseCaseError on failure
   */
  async execute(
    input: AddConversationNoteInput
  ): Promise<Result<AddConversationNoteOutput, UseCaseError>> {
    // 1. Create domain entity (validates invariants)
    const createResult = ConversationNote.create({
      conversationId: input.conversationId,
      authorId: input.authorId,
      body: input.body,
    });

    if (!createResult.ok) {
      return err(new UseCaseError(createResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const note = createResult.value;

    // 2. Persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<AddConversationNoteOutput, UseCaseError>> => {
      const saveResult = await this.noteRepo.save(note);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save conversation note",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      return ok({ id: note.id });
    };

    let persistResult: Result<AddConversationNoteOutput, UseCaseError>;

    try {
      if (this.unitOfWork) {
        let result: Result<AddConversationNoteOutput, UseCaseError> = ok({ id: note.id });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        persistResult = result;
      } else {
        persistResult = await doWork();
      }
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to persist conversation note",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }

    // 3. After successful persistence, notify mentioned users (fire-and-forget)
    if (persistResult.ok && this.mentionNotifier) {
      void this.mentionNotifier.notify({
        text: input.body,
        accountId: input.accountId,
        mentionedById: input.authorId,
        mentionedByName: input.authorName,
        context: MENTION_CONTEXT.CONVERSATION_NOTE,
        contextId: input.conversationId,
      });
    }

    return persistResult;
  }
}
