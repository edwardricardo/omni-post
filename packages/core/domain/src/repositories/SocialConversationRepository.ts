/**
 * @file SocialConversationRepository.ts
 * @description Repository port for SocialConversation entity persistence.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type EntityNotFoundError } from "../errors/index.js";
import { type SocialConversationId } from "../value-objects/SocialConversationId.js";
import { type SocialConversation } from "../entities/SocialConversation.js";
import { type ProviderType } from "../value-objects/Provider.js";

/**
 * DTO for conversation list items (read side).
 */
export interface SocialConversationDTO {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string;
  provider: string;
  subject: string | null;
  participantCount: number;
  messageCount: number;
  lastMessageAt: Date;
  isResolved: boolean;
  resolvedAt: Date | null;
  resolvedById: string | null;
  rootProviderMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @interface SocialConversationRepository
 * @description Repository port for SocialConversation entity persistence and queries.
 */
export interface SocialConversationRepository {
  /**
   * @method findById
   * @description Find a conversation by its ID.
   * @param id - The SocialConversationId
   * @returns Result containing the entity on success, EntityNotFoundError on failure
   */
  findById(id: SocialConversationId): Promise<Result<SocialConversation, EntityNotFoundError>>;

  /**
   * @method findOrCreateByRoot
   * @description Find a conversation by rootProviderMessageId, or create a new one.
   *   Used during message ingestion to group messages by thread.
   * @param provider - The social provider
   * @param rootProviderMessageId - The root message ID from the provider
   * @param createInput - Input to create a new conversation if not found
   * @returns The existing or newly created conversation
   */
  findOrCreateByRoot(
    provider: ProviderType,
    rootProviderMessageId: string,
    createInput: {
      accountId: string;
      projectId: string;
      channelId: string;
      lastMessageAt: Date;
      subject?: string;
    }
  ): Promise<Result<SocialConversation, Error>>;

  /**
   * @method save
   * @description Persist a conversation entity (create or update).
   * @param entity - The SocialConversation to save
   * @returns Result<void> on success, Error on failure
   */
  save(entity: SocialConversation): Promise<Result<void, Error>>;

  /**
   * @method findByProject
   * @description List conversations for a project with optional resolution filter.
   * @param projectId - The project ID
   * @param isResolved - Optional filter by resolved state
   * @param limit - Max results (default 50)
   * @param offset - Offset for pagination (default 0)
   * @returns List of conversation DTOs
   */
  findByProject(
    projectId: string,
    isResolved?: boolean,
    limit?: number,
    offset?: number
  ): Promise<SocialConversationDTO[]>;
}
