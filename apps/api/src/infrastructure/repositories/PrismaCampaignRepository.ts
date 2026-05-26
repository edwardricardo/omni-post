/**
 * @file PrismaCampaignRepository.ts
 * @description Prisma adapter implementing the CampaignRepository port.
 *   Handles persistence and retrieval of Campaign entities, including
 *   upsert, delete, and CampaignPost join table management.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import { type CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import { Campaign, type CampaignProps } from "@core/domain/entities/Campaign.js";
import { CampaignId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import { CampaignStatus } from "@core/domain/value-objects/CampaignStatus.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

/**
 * Shape of a raw Campaign row returned by Prisma queries.
 * Used internally to type the result of findUnique calls
 * without importing Prisma-generated model types into the domain.
 */
interface PrismaCampaignRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  utmSource: string | null;
  utmMedium: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaCampaignRepository
 * @description Infrastructure adapter implementing CampaignRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaCampaignRepository implements CampaignRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a Campaign entity via upsert (create or update).
   *   Maps all entity getters to Prisma model fields using conditional spreads
   *   for optional properties.
   * @param campaign - The Campaign entity to persist
   * @returns Result<void> on success, Error on failure
   */
  async save(campaign: Campaign): Promise<Result<void, Error>> {
    try {
      const data = {
        projectId: campaign.projectId.value,
        name: campaign.name,
        status: campaign.status.value as $Enums.CampaignStatus,
        ...(campaign.description !== undefined && {
          description: campaign.description,
        }),
        ...(campaign.startDate !== undefined && {
          startDate: campaign.startDate,
        }),
        ...(campaign.endDate !== undefined && {
          endDate: campaign.endDate,
        }),
        ...(campaign.utmSource !== undefined && {
          utmSource: campaign.utmSource,
        }),
        ...(campaign.utmMedium !== undefined && {
          utmMedium: campaign.utmMedium,
        }),
      };

      await this.prisma.campaign.upsert({
        where: { id: campaign.id.value },
        create: {
          id: campaign.id.value,
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
   * @method findById
   * @description Finds a Campaign entity by its domain ID and reconstitutes it.
   * @param id - The CampaignId to look up
   * @returns Result containing the reconstituted entity, or EntityNotFoundError
   */
  async findById(id: CampaignId): Promise<Result<Campaign, EntityNotFoundError>> {
    const row = await this.prisma.campaign.findUnique({
      where: { id: id.value },
    });

    if (!row) {
      return err(new EntityNotFoundError("Campaign", id.value));
    }

    return ok(this.toDomain(row as unknown as PrismaCampaignRow));
  }

  /**
   * @method delete
   * @description Deletes a Campaign by its ID. CampaignPost records are
   *   cascade-deleted by the database foreign key constraint.
   * @param id - The CampaignId to delete
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  async delete(id: CampaignId): Promise<Result<void, EntityNotFoundError>> {
    const exists = await this.prisma.campaign.findUnique({
      where: { id: id.value },
      select: { id: true },
    });

    if (!exists) {
      return err(new EntityNotFoundError("Campaign", id.value));
    }

    await this.prisma.campaign.delete({
      where: { id: id.value },
    });

    return ok(undefined);
  }

  /**
   * @method addPost
   * @description Tags a post with the given campaign by creating a CampaignPost
   *   join table record.
   * @param campaignId - The campaign to tag
   * @param postId - The post to tag with the campaign
   * @returns Result<void> on success, Error on failure
   */
  async addPost(campaignId: CampaignId, postId: string): Promise<Result<void, Error>> {
    try {
      await this.prisma.campaignPost.create({
        data: {
          campaignId: campaignId.value,
          postId,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method removePost
   * @description Untags a post from the given campaign by deleting the
   *   CampaignPost join table record.
   * @param campaignId - The campaign to untag from
   * @param postId - The post to untag
   * @returns Result<void> on success, Error on failure
   */
  async removePost(campaignId: CampaignId, postId: string): Promise<Result<void, Error>> {
    try {
      await this.prisma.campaignPost.delete({
        where: {
          campaignId_postId: {
            campaignId: campaignId.value,
            postId,
          },
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDomain
   * @description Reconstitutes a Campaign entity from a raw Prisma row.
   *   Uses fromStringUnsafe for IDs (data already validated in DB).
   *   Falls back to DRAFT status if CampaignStatus parsing fails.
   * @param row - The raw Prisma Campaign row
   * @returns A fully hydrated Campaign entity
   */
  private toDomain(row: PrismaCampaignRow): Campaign {
    const statusResult = CampaignStatus.fromString(row.status);
    const status = statusResult.ok ? statusResult.value : CampaignStatus.draft();

    const props: CampaignProps = {
      id: CampaignId.fromStringUnsafe(row.id),
      projectId: ProjectId.fromStringUnsafe(row.projectId),
      name: row.name,
      status,
      createdAt: row.createdAt,
      ...(row.description !== null && { description: row.description }),
      ...(row.startDate !== null && { startDate: row.startDate }),
      ...(row.endDate !== null && { endDate: row.endDate }),
      ...(row.utmSource !== null && { utmSource: row.utmSource }),
      ...(row.utmMedium !== null && { utmMedium: row.utmMedium }),
    };

    return Campaign.fromPersistence(props);
  }
}
