/**
 * @file ListConversationNotesQuery.ts
 * @description CQRS query that returns all non-deleted notes for a conversation.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ConversationNoteRepository } from "../../domain/repositories/ConversationNoteRepository.js";

/**
 * Input DTO for listing conversation notes.
 */
export interface ListConversationNotesInput {
  conversationId: string;
}

/**
 * Output DTO representing a single note in the list.
 */
export interface ConversationNoteDTO {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class ListConversationNotesQuery
 * @description Returns all active (non-deleted) notes for a given conversation.
 */
export class ListConversationNotesQuery implements UseCase<
  ListConversationNotesInput,
  ConversationNoteDTO[],
  UseCaseError
> {
  constructor(private readonly noteRepo: ConversationNoteRepository) {}

  /**
   * @method execute
   * @description Fetches notes from the repository and maps to DTOs.
   * @param input - Contains the conversationId
   * @returns Result containing an array of note DTOs
   */
  async execute(
    input: ListConversationNotesInput
  ): Promise<Result<ConversationNoteDTO[], UseCaseError>> {
    try {
      const notes = await this.noteRepo.findByConversation(input.conversationId);

      const dtos: ConversationNoteDTO[] = notes.map((note) => ({
        id: note.id,
        conversationId: note.conversationId,
        authorId: note.authorId,
        body: note.body,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }));

      return ok(dtos);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to list conversation notes",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
