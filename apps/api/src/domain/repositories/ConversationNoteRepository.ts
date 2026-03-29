/**
 * @file ConversationNoteRepository.ts
 * @description Port interface for persisting and querying ConversationNote entities.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { ConversationNote } from "../entities/ConversationNote.js";

/**
 * Repository port for ConversationNote aggregate persistence.
 */
export interface ConversationNoteRepository {
  /**
   * Find a single note by its unique identifier.
   */
  findById(id: string): Promise<Result<ConversationNote, Error>>;

  /**
   * Return all non-deleted notes for a conversation, newest first.
   */
  findByConversation(conversationId: string): Promise<ConversationNote[]>;

  /**
   * Persist a note (create or update via upsert).
   */
  save(note: ConversationNote): Promise<Result<void, Error>>;

  /**
   * Soft-delete a note by setting its deletedAt timestamp.
   */
  softDelete(id: string): Promise<Result<void, Error>>;
}
