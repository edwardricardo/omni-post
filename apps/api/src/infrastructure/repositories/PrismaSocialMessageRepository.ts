/**
 * @file PrismaSocialMessageRepository.ts
 * @description Prisma adapter implementing the SocialMessageRepository port.
 *   Handles persistence and retrieval of SocialMessage aggregates for the
 *   Social Inbox feature, including upsert, dedup lookup, and soft-delete.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import { type SocialMessageRepository } from "@core/domain/repositories/SocialMessageRepository.js";
import {
  SocialMessageAggregate,
  type SocialMessageState,
} from "@core/domain/aggregates/SocialMessageAggregate.js";
import { SocialMessageId } from "@core/domain/value-objects/SocialMessageId.js";
import { SocialConversationId } from "@core/domain/value-objects/SocialConversationId.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/index.js";
import { SocialMessageType } from "@core/domain/value-objects/SocialMessageType.js";
import { SocialMessageStatus } from "@core/domain/value-objects/SocialMessageStatus.js";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

/**
 * Shape of a raw SocialMessage row returned by Prisma queries.
 * Used internally to type the result of findUnique/findFirst calls
 * without importing Prisma-generated model types into the domain.
 */
interface PrismaSocialMessageRow {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string;
  conversationId: string | null;
  provider: string;
  providerMessageId: string;
  providerParentId: string | null;
  messageType: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  body: string;
  mediaUrls: string[];
  webhookEventId: string | null;
  relatedPostId: string | null;
  status: string;
  assigneeId: string | null;
  isArchived: boolean;
  providerCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaSocialMessageRepository
 * @description Infrastructure adapter implementing SocialMessageRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaSocialMessageRepository implements SocialMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a SocialMessage aggregate by its domain ID.
   * @param id - The SocialMessageId to look up
   * @returns Result containing the reconstituted aggregate, or EntityNotFoundError
   */
  async findById(
    id: SocialMessageId
  ): Promise<Result<SocialMessageAggregate, EntityNotFoundError>> {
    const row = await this.prisma.socialMessage.findUnique({
      where: { id: id.value },
    });

    if (!row) {
      return err(new EntityNotFoundError("SocialMessage", id.value));
    }

    return ok(this.toDomain(row as unknown as PrismaSocialMessageRow));
  }

  /**
   * @method findByProviderMessageId
   * @description Finds a SocialMessage by the composite unique key (provider + providerMessageId).
   *   Used for deduplication during webhook ingestion.
   * @param provider - The social media provider
   * @param providerMessageId - The external message ID from the provider
   * @returns The reconstituted aggregate if found, null otherwise
   */
  async findByProviderMessageId(
    provider: ProviderType,
    providerMessageId: string
  ): Promise<SocialMessageAggregate | null> {
    const row = await this.prisma.socialMessage.findUnique({
      where: {
        provider_providerMessageId: {
          provider: provider as $Enums.Provider,
          providerMessageId,
        },
      },
    });

    if (!row) {
      return null;
    }

    return this.toDomain(row as unknown as PrismaSocialMessageRow);
  }

  /**
   * @method save
   * @description Persists a SocialMessage aggregate via upsert (create or update).
   *   Maps all aggregate getters to Prisma model fields.
   * @param aggregate - The SocialMessage aggregate to persist
   * @returns Result<void> on success, Error on failure
   */
  async save(aggregate: SocialMessageAggregate): Promise<Result<void, Error>> {
    try {
      const mediaUrls = [...aggregate.mediaUrls];

      const data = {
        accountId: aggregate.accountId.value,
        projectId: aggregate.projectId.value,
        channelId: aggregate.channelId.value,
        provider: aggregate.provider as $Enums.Provider,
        providerMessageId: aggregate.providerMessageId,
        messageType: aggregate.messageType.value as $Enums.SocialMessageType,
        authorName: aggregate.authorName,
        authorProviderId: aggregate.authorProviderId,
        body: aggregate.body,
        mediaUrls,
        status: aggregate.status.value as $Enums.SocialMessageStatus,
        isArchived: aggregate.isArchived,
        providerCreatedAt: aggregate.providerCreatedAt,
        ...(aggregate.conversationId !== null && {
          conversationId: aggregate.conversationId.value,
        }),
        ...(aggregate.providerParentId !== null && {
          providerParentId: aggregate.providerParentId,
        }),
        ...(aggregate.authorHandle !== null && {
          authorHandle: aggregate.authorHandle,
        }),
        ...(aggregate.authorAvatarUrl !== null && {
          authorAvatarUrl: aggregate.authorAvatarUrl,
        }),
        ...(aggregate.webhookEventId !== null && {
          webhookEventId: aggregate.webhookEventId,
        }),
        ...(aggregate.relatedPostId !== null && {
          relatedPostId: aggregate.relatedPostId,
        }),
        ...(aggregate.assigneeId !== null && {
          assigneeId: aggregate.assigneeId,
        }),
      };

      await this.prisma.socialMessage.upsert({
        where: { id: aggregate.id.value },
        create: {
          id: aggregate.id.value,
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
   * @method softDelete
   * @description Soft-deletes a SocialMessage by setting isArchived=true and status=ARCHIVED.
   * @param id - The SocialMessageId to archive
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  async softDelete(id: SocialMessageId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.socialMessage.findUnique({
      where: { id: id.value },
      select: { id: true },
    });

    if (!exists) {
      return err(new EntityNotFoundError("SocialMessage", id.value));
    }

    await this.prisma.socialMessage.update({
      where: { id: id.value },
      data: {
        isArchived: true,
        status: "ARCHIVED" as $Enums.SocialMessageStatus,
      },
    });

    return ok(undefined);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDomain
   * @description Reconstitutes a SocialMessageAggregate from a raw Prisma row.
   *   Uses fromStringUnsafe for IDs (data already validated in DB).
   *   Falls back to factory methods for value objects if Result parsing fails.
   * @param row - The raw Prisma SocialMessage row
   * @returns A fully hydrated SocialMessageAggregate
   */
  private toDomain(row: PrismaSocialMessageRow): SocialMessageAggregate {
    const messageTypeResult = SocialMessageType.create(row.messageType);
    const messageType = messageTypeResult.ok
      ? messageTypeResult.value
      : SocialMessageType.comment();

    const statusResult = SocialMessageStatus.fromString(row.status);
    const status = statusResult.ok ? statusResult.value : SocialMessageStatus.unread();

    const state: SocialMessageState = {
      id: SocialMessageId.fromStringUnsafe(row.id),
      accountId: AccountId.fromStringUnsafe(row.accountId),
      projectId: ProjectId.fromStringUnsafe(row.projectId),
      channelId: ChannelId.fromStringUnsafe(row.channelId),
      conversationId:
        row.conversationId !== null
          ? SocialConversationId.fromStringUnsafe(row.conversationId)
          : null,
      provider: row.provider as ProviderType,
      providerMessageId: row.providerMessageId,
      providerParentId: row.providerParentId,
      messageType,
      authorName: row.authorName,
      authorHandle: row.authorHandle,
      authorAvatarUrl: row.authorAvatarUrl,
      authorProviderId: row.authorProviderId,
      body: row.body,
      mediaUrls: [...row.mediaUrls],
      webhookEventId: row.webhookEventId,
      relatedPostId: row.relatedPostId,
      status,
      assigneeId: row.assigneeId,
      isArchived: row.isArchived,
      providerCreatedAt: row.providerCreatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: 0,
    };

    return SocialMessageAggregate.reconstitute(state);
  }
}
