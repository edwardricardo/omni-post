/**
 * @file MentionRepository.ts
 * @description Prisma adapter implementing the `@core/domain` MentionRepository
 *   command port: provider dedup lookup + insert of ingested brand mentions.
 *   Canonical full-domain adapter (consumed by the mention-ingest worker). The
 *   read side stays in the API-side query repository.
 * @layer infrastructure
 */

import type { PrismaClient, $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import { type MentionRepository } from "@core/domain/repositories/MentionRepository.js";
import {
  MentionAggregate,
  type MentionState,
  type MentionSource,
  type MentionSentimentLabel,
} from "@core/domain/aggregates/MentionAggregate.js";
import { MentionId } from "@core/domain/value-objects/MentionId.js";
import { AccountId, ProjectId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import { type ProviderType } from "@core/domain/value-objects/Provider.js";

/**
 * Shape of a raw Mention row returned by Prisma, typed locally so the
 * generated model types never leak into the domain.
 */
interface PrismaMentionRow {
  id: string;
  accountId: string;
  projectId: string;
  channelId: string | null;
  provider: string;
  externalId: string;
  trackedTermId: string | null;
  source: string;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  url: string | null;
  body: string;
  lang: string | null;
  mediaUrls: string[];
  sentimentScore: { toString(): string } | null;
  sentimentLabel: string | null;
  providerCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaMentionRepository
 * @description Implements the MentionRepository command port over Prisma.
 */
export class PrismaMentionRepository implements MentionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByProviderExternalId
   * @description Provider dedup lookup by (provider, externalId).
   */
  async findByProviderExternalId(
    provider: ProviderType,
    externalId: string
  ): Promise<MentionAggregate | null> {
    const row = await this.prisma.mention.findFirst({
      where: { provider: provider as $Enums.Provider, externalId },
    });
    if (!row) {
      return null;
    }
    return this.toDomain(row as unknown as PrismaMentionRow);
  }

  /**
   * @method save
   * @description Insert a new mention. The unique (provider, externalId)
   *   constraint makes this idempotent: a concurrent insert (P2002) is treated
   *   as success (the mention already exists).
   */
  async save(mention: MentionAggregate): Promise<Result<void, Error>> {
    try {
      await this.prisma.mention.create({
        data: {
          id: mention.id.value,
          accountId: mention.accountId.value,
          projectId: mention.projectId.value,
          provider: mention.provider as $Enums.Provider,
          externalId: mention.externalId,
          source: mention.source as $Enums.MentionSource,
          ...(mention.trackedTermId !== null && { trackedTermId: mention.trackedTermId }),
          ...(mention.channelId !== null && { channelId: mention.channelId.value }),
          authorName: mention.authorName,
          ...(mention.authorHandle !== null && { authorHandle: mention.authorHandle }),
          ...(mention.authorAvatarUrl !== null && { authorAvatarUrl: mention.authorAvatarUrl }),
          authorProviderId: mention.authorProviderId,
          ...(mention.url !== null && { url: mention.url }),
          body: mention.body,
          ...(mention.lang !== null && { lang: mention.lang }),
          mediaUrls: [...mention.mediaUrls],
          providerCreatedAt: mention.providerCreatedAt,
        },
      });
      return ok(undefined);
    } catch (error: unknown) {
      // Unique (provider, externalId) violation → already ingested (idempotent).
      if (
        error !== null &&
        typeof error === "object" &&
        (error as { code?: string }).code === "P2002"
      ) {
        return ok(undefined);
      }
      return err(error instanceof Error ? error : new Error("Failed to save mention"));
    }
  }

  /**
   * @method toDomain
   * @description Reconstitutes a Mention aggregate from a raw row. Uses
   *   fromStringUnsafe for IDs (already validated in the DB).
   */
  private toDomain(row: PrismaMentionRow): MentionAggregate {
    const state: MentionState = {
      id: MentionId.fromStringUnsafe(row.id),
      accountId: AccountId.fromStringUnsafe(row.accountId),
      projectId: ProjectId.fromStringUnsafe(row.projectId),
      channelId: row.channelId !== null ? ChannelId.fromStringUnsafe(row.channelId) : null,
      provider: row.provider as ProviderType,
      externalId: row.externalId,
      source: row.source as MentionSource,
      trackedTermId: row.trackedTermId,
      authorName: row.authorName,
      authorHandle: row.authorHandle,
      authorAvatarUrl: row.authorAvatarUrl,
      authorProviderId: row.authorProviderId,
      url: row.url,
      body: row.body,
      lang: row.lang,
      mediaUrls: [...row.mediaUrls],
      sentimentScore: row.sentimentScore !== null ? Number(row.sentimentScore.toString()) : null,
      sentimentLabel: row.sentimentLabel as MentionSentimentLabel | null,
      providerCreatedAt: row.providerCreatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: 0,
    };
    return MentionAggregate.reconstitute(state);
  }
}
