/**
 * @file PrismaCampaignQueryRepository.ts
 * @description Prisma adapter implementing the CampaignQueryRepository port.
 *   Read-side repository for Campaign CQRS query path. Returns flat DTOs
 *   with optional filtering and offset-based pagination (no domain reconstitution).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";

import {
  type CampaignQueryRepository,
  type CampaignDto,
  type CampaignWithStats,
  type ListCampaignsOptions,
} from "@core/domain/repositories/CampaignQueryRepository.js";

/**
 * Shape of a raw Campaign row returned by Prisma queries.
 * Used internally to type query results without importing
 * Prisma-generated model types into the domain.
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
 * Shape of a Campaign row with _count include for post statistics.
 */
interface PrismaCampaignWithCount extends PrismaCampaignRow {
  _count: {
    posts: number;
  };
}

/**
 * Shape of a CampaignPost row returned when querying post IDs.
 */
interface PrismaCampaignPostRow {
  postId: string;
}

/**
 * @class PrismaCampaignQueryRepository
 * @description Infrastructure adapter for read-model queries on campaigns.
 *   Implements offset-based pagination with optional status filtering.
 */
export class PrismaCampaignQueryRepository implements CampaignQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByProjectId
   * @description Lists campaigns for a project with optional status filter
   *   and offset-based pagination. Orders by createdAt DESC (newest first).
   * @param projectId - The project ID to filter by
   * @param options - Optional status filter, limit, and offset
   * @returns Array of CampaignDto
   */
  async findByProjectId(projectId: string, options?: ListCampaignsOptions): Promise<CampaignDto[]> {
    const where: Record<string, unknown> = {
      projectId,
      ...(options?.status !== undefined && {
        status: options.status as $Enums.CampaignStatus,
      }),
    };

    const rows = await this.prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(options?.limit !== undefined && { take: options.limit }),
      ...(options?.offset !== undefined && { skip: options.offset }),
    });

    return (rows as unknown as PrismaCampaignRow[]).map((row) => this.toDto(row));
  }

  /**
   * @method findPostIdsByCampaignId
   * @description Retrieves all post IDs tagged with a given campaign,
   *   ordered by taggedAt DESC (most recently tagged first).
   * @param campaignId - The campaign ID to query
   * @returns Array of post ID strings
   */
  async findPostIdsByCampaignId(campaignId: string): Promise<string[]> {
    const rows = await this.prisma.campaignPost.findMany({
      where: { campaignId },
      select: { postId: true },
      orderBy: { taggedAt: "desc" },
    });

    return (rows as PrismaCampaignPostRow[]).map((row) => row.postId);
  }

  /**
   * @method getCampaignWithStats
   * @description Retrieves a single campaign with its post count.
   *   Uses Prisma _count include for efficient aggregation.
   * @param campaignId - The campaign ID to query
   * @returns CampaignWithStats if found, null otherwise
   */
  async getCampaignWithStats(campaignId: string): Promise<CampaignWithStats | null> {
    const row = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: { posts: true },
        },
      },
    });

    if (!row) {
      return null;
    }

    const typedRow = row as unknown as PrismaCampaignWithCount;

    return {
      ...this.toDto(typedRow),
      postCount: typedRow._count.posts,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDto
   * @description Maps a raw Prisma Campaign row to a CampaignDto (flat read model).
   * @param row - The raw Prisma row
   * @returns A CampaignDto
   */
  private toDto(row: PrismaCampaignRow): CampaignDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
