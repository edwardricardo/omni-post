/**
 * @file PrismaSocialConversationRepository.ts
 * @description Prisma adapter implementing the SocialConversationRepository port.
 *   Handles persistence, retrieval, and find-or-create logic for SocialConversation
 *   entities in the Social Inbox feature.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import {
  type SocialConversationRepository,
  type SocialConversationDTO,
} from "@core/domain/repositories/SocialConversationRepository.js";
import {
  SocialConversation,
  type SocialConversationState,
} from "@core/domain/entities/SocialConversation.js";
import { SocialConversationId } from "@core/domain/value-objects/SocialConversationId.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/index.js";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

/**
 * Shape of a raw SocialConversation row returned by Prisma queries.
 */
interface PrismaSocialConversationRow {
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
 * @class PrismaSocialConversationRepository
 * @description Infrastructure adapter implementing SocialConversationRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaSocialConversationRepository implements SocialConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a SocialConversation entity by its domain ID.
   * @param id - The SocialConversationId to look up
   * @returns Result containing the reconstituted entity, or EntityNotFoundError
   */
  async findById(
    id: SocialConversationId
  ): Promise<Result<SocialConversation, EntityNotFoundError>> {
    const row = await this.prisma.socialConversation.findUnique({
      where: { id: id.value },
    });

    if (!row) {
      return err(new EntityNotFoundError("SocialConversation", id.value));
    }

    return ok(this.toDomain(row as unknown as PrismaSocialConversationRow));
  }

  /**
   * @method findOrCreateByRoot
   * @description Finds a conversation by provider + rootProviderMessageId, or creates
   *   a new one if not found. Used during message ingestion to group messages by thread.
   * @param provider - The social media provider
   * @param rootProviderMessageId - The root message ID from the provider
   * @param createInput - Input to create a new conversation if not found
   * @returns Result containing the existing or newly created conversation
   */
  async findOrCreateByRoot(
    provider: ProviderType,
    rootProviderMessageId: string,
    createInput: {
      accountId: string;
      projectId: string;
      channelId: string;
      lastMessageAt: Date;
      subject?: string;
    }
  ): Promise<Result<SocialConversation, Error>> {
    try {
      const existing = await this.prisma.socialConversation.findFirst({
        where: {
          provider: provider as $Enums.Provider,
          rootProviderMessageId,
        },
      });

      if (existing) {
        return ok(this.toDomain(existing as unknown as PrismaSocialConversationRow));
      }

      const createResult = SocialConversation.create({
        accountId: AccountId.fromStringUnsafe(createInput.accountId),
        projectId: ProjectId.fromStringUnsafe(createInput.projectId),
        channelId: ChannelId.fromStringUnsafe(createInput.channelId),
        provider,
        lastMessageAt: createInput.lastMessageAt,
        rootProviderMessageId,
        ...(createInput.subject !== undefined && {
          subject: createInput.subject,
        }),
      });

      if (!createResult.ok) {
        return err(new Error(`Failed to create conversation: ${createResult.error.message}`));
      }

      const entity = createResult.value;
      const saveResult = await this.save(entity);

      if (!saveResult.ok) {
        return err(saveResult.error);
      }

      return ok(entity);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method save
   * @description Persists a SocialConversation entity via upsert (create or update).
   * @param entity - The SocialConversation to persist
   * @returns Result<void> on success, Error on failure
   */
  async save(entity: SocialConversation): Promise<Result<void, Error>> {
    try {
      const data = {
        accountId: entity.accountId.value,
        projectId: entity.projectId.value,
        channelId: entity.channelId.value,
        provider: entity.provider as $Enums.Provider,
        participantCount: entity.participantCount,
        messageCount: entity.messageCount,
        lastMessageAt: entity.lastMessageAt,
        isResolved: entity.isResolved,
        ...(entity.subject !== null && { subject: entity.subject }),
        ...(entity.resolvedAt !== null && { resolvedAt: entity.resolvedAt }),
        ...(entity.resolvedById !== null && {
          resolvedById: entity.resolvedById,
        }),
        ...(entity.rootProviderMessageId !== null && {
          rootProviderMessageId: entity.rootProviderMessageId,
        }),
      };

      await this.prisma.socialConversation.upsert({
        where: { id: entity.id.value },
        create: {
          id: entity.id.value,
          ...data,
        },
        update: {
          ...data,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findByProject
   * @description Lists conversations for a project with optional resolution filter.
   *   Returns flat DTOs for the read side (no domain reconstitution).
   * @param projectId - The project ID
   * @param isResolved - Optional filter by resolved state
   * @param limit - Max results (default 50)
   * @param offset - Offset for pagination (default 0)
   * @returns List of SocialConversationDTO items
   */
  async findByProject(
    projectId: string,
    isResolved?: boolean,
    limit?: number,
    offset?: number
  ): Promise<SocialConversationDTO[]> {
    const effectiveLimit = limit ?? 50;
    const effectiveOffset = offset ?? 0;

    const rows = await this.prisma.socialConversation.findMany({
      where: {
        projectId,
        ...(isResolved !== undefined && { isResolved }),
      },
      orderBy: { lastMessageAt: "desc" },
      take: effectiveLimit,
      skip: effectiveOffset,
    });

    return (rows as unknown as PrismaSocialConversationRow[]).map((row) => this.toDTO(row));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDomain
   * @description Reconstitutes a SocialConversation entity from a raw Prisma row.
   *   Uses fromStringUnsafe for IDs (data already validated in DB).
   * @param row - The raw Prisma SocialConversation row
   * @returns A fully hydrated SocialConversation instance
   */
  private toDomain(row: PrismaSocialConversationRow): SocialConversation {
    const state: SocialConversationState = {
      id: SocialConversationId.fromStringUnsafe(row.id),
      accountId: AccountId.fromStringUnsafe(row.accountId),
      projectId: ProjectId.fromStringUnsafe(row.projectId),
      channelId: ChannelId.fromStringUnsafe(row.channelId),
      provider: row.provider as ProviderType,
      subject: row.subject,
      participantCount: row.participantCount,
      messageCount: row.messageCount,
      lastMessageAt: row.lastMessageAt,
      isResolved: row.isResolved,
      resolvedAt: row.resolvedAt,
      resolvedById: row.resolvedById,
      rootProviderMessageId: row.rootProviderMessageId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return SocialConversation.reconstitute(state);
  }

  /**
   * @method toDTO
   * @description Maps a raw Prisma row to a SocialConversationDTO (flat read model).
   * @param row - The raw Prisma row
   * @returns A SocialConversationDTO
   */
  private toDTO(row: PrismaSocialConversationRow): SocialConversationDTO {
    return {
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      channelId: row.channelId,
      provider: row.provider,
      subject: row.subject,
      participantCount: row.participantCount,
      messageCount: row.messageCount,
      lastMessageAt: row.lastMessageAt,
      isResolved: row.isResolved,
      resolvedAt: row.resolvedAt,
      resolvedById: row.resolvedById,
      rootProviderMessageId: row.rootProviderMessageId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
