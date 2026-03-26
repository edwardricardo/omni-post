/**
 * @file PrismaMediaAssetRepository.ts
 * @description Prisma adapter implementing the MediaAssetRepository port.
 *   Supports cursor-based pagination, tag filtering, soft-delete, and
 *   transactional tag replacement via the AssetTagOnAsset join table.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import {
  type MediaAssetRepository,
  type MediaAssetFilters,
  type MediaAssetPaginatedResult,
} from "../../domain/repositories/MediaAssetRepository.js";
import { MediaAsset, MediaAssetId } from "../../domain/entities/MediaAsset.js";

/**
 * Raw Prisma row shape for a MediaAsset including its tags join.
 */
interface PrismaMediaAssetRow {
  id: string;
  accountId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  usageCount: number;
  folderId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tags?: Array<{ tagId: string }>;
}

/**
 * Default page size when not specified.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * @class PrismaMediaAssetRepository
 * @description Infrastructure adapter implementing MediaAssetRepository using Prisma ORM.
 */
export class PrismaMediaAssetRepository implements MediaAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a media asset by ID within an account, including tag associations.
   * @param id - The asset UUID
   * @param accountId - Ownership scope
   * @returns The reconstituted MediaAsset entity, or null if not found / deleted
   */
  async findById(id: string, accountId: string): Promise<MediaAsset | null> {
    const row = await this.prisma.mediaAsset.findFirst({
      where: {
        id,
        accountId,
        deletedAt: null,
      },
      include: {
        tags: { select: { tagId: true } },
      },
    });

    if (!row) {
      return null;
    }

    return this.toDomain(row as unknown as PrismaMediaAssetRow);
  }

  /**
   * @method findMany
   * @description Queries media assets with filters, tag filtering, and cursor-based pagination.
   * @param filters - Query criteria including accountId, optional folderId, tagIds, etc.
   * @returns Paginated result with items, total count, and next cursor
   */
  async findMany(filters: MediaAssetFilters): Promise<MediaAssetPaginatedResult> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where = this.buildWhereClause(filters);

    const [items, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where,
        include: {
          tags: { select: { tagId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(filters.cursor !== undefined &&
          filters.cursor !== null && {
            cursor: { id: filters.cursor },
            skip: 1,
          }),
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const lastItem = pageItems[pageItems.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return {
      items: pageItems.map((row) => this.toDomain(row as unknown as PrismaMediaAssetRow)),
      total,
      hasMore,
      nextCursor,
    };
  }

  /**
   * @method save
   * @description Persists a MediaAsset entity via upsert (create or update).
   *   Includes tag associations on creation via nested createMany.
   * @param asset - The MediaAsset entity to persist
   * @returns Result<MediaAsset> on success, Error on failure
   */
  async save(asset: MediaAsset): Promise<Result<MediaAsset, Error>> {
    try {
      const data = {
        accountId: asset.accountId,
        name: asset.name,
        url: asset.url,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        usageCount: asset.usageCount,
        ...(asset.projectId !== undefined && { projectId: asset.projectId }),
        ...(asset.description !== undefined && { description: asset.description }),
        ...(asset.width !== undefined && { width: asset.width }),
        ...(asset.height !== undefined && { height: asset.height }),
        ...(asset.duration !== undefined && { duration: asset.duration }),
        ...(asset.folderId !== undefined && { folderId: asset.folderId }),
        ...(asset.deletedAt !== undefined && { deletedAt: asset.deletedAt }),
      };

      const tagIds = asset.tagIds;

      await this.prisma.mediaAsset.upsert({
        where: { id: asset.id.value },
        create: {
          id: asset.id.value,
          ...data,
          ...(tagIds.length > 0 && {
            tags: {
              createMany: {
                data: tagIds.map((tagId) => ({ tagId })),
              },
            },
          }),
        },
        update: {
          ...data,
        },
      });

      return ok(asset);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method softDelete
   * @description Marks a media asset as deleted using the deletedAt timestamp.
   *   Guards by accountId to enforce multi-tenant isolation.
   * @param id - The asset UUID
   * @param accountId - Ownership scope
   * @returns Result<void> on success, Error on failure
   */
  async softDelete(id: string, accountId: string): Promise<Result<void, Error>> {
    try {
      const result = await this.prisma.mediaAsset.updateMany({
        where: {
          id,
          accountId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      if (result.count === 0) {
        return err(new Error(`Media asset not found or already deleted: ${id}`));
      }

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method updateTags
   * @description Replaces all tag associations for an asset within a single transaction.
   *   Deletes all existing associations, then creates new ones.
   * @param assetId - The asset UUID
   * @param tagIds - The new set of tag IDs to associate
   * @returns Result<void> on success, Error on failure
   */
  async updateTags(assetId: string, tagIds: string[]): Promise<Result<void, Error>> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.assetTagOnAsset.deleteMany({
          where: { assetId },
        });

        if (tagIds.length > 0) {
          await tx.assetTagOnAsset.createMany({
            data: tagIds.map((tagId) => ({ assetId, tagId })),
          });
        }
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
   * @method buildWhereClause
   * @description Constructs the Prisma where clause from filter criteria.
   */
  private buildWhereClause(filters: MediaAssetFilters): Record<string, unknown> {
    const where: Record<string, unknown> = {
      accountId: filters.accountId,
      deletedAt: null,
    };

    if (filters.projectId !== undefined) {
      where.projectId = filters.projectId;
    }

    if (filters.folderId !== undefined) {
      where.folderId = filters.folderId;
    }

    if (filters.mimeType !== undefined) {
      where.mimeType = { startsWith: filters.mimeType };
    }

    if (filters.search !== undefined && filters.search.trim().length > 0) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.tagIds !== undefined && filters.tagIds.length > 0) {
      where.tags = {
        some: {
          tagId: { in: filters.tagIds },
        },
      };
    }

    return where;
  }

  /**
   * @method toDomain
   * @description Reconstitutes a MediaAsset entity from a raw Prisma row.
   */
  private toDomain(row: PrismaMediaAssetRow): MediaAsset {
    const idResult = MediaAssetId.fromString(row.id);
    if (!idResult.ok) {
      // Data from DB is already validated; use generate as fallback
      const fallbackId = MediaAssetId.generate();
      return this.reconstituteEntity(fallbackId, row);
    }

    return this.reconstituteEntity(idResult.value, row);
  }

  /**
   * @method reconstituteEntity
   * @description Builds a MediaAsset entity from a validated ID and raw row.
   */
  private reconstituteEntity(id: MediaAssetId, row: PrismaMediaAssetRow): MediaAsset {
    const tagIds = row.tags ? row.tags.map((t) => t.tagId) : [];

    return MediaAsset.reconstitute({
      id,
      accountId: row.accountId,
      ...(row.projectId !== null && { projectId: row.projectId }),
      name: row.name,
      ...(row.description !== null && { description: row.description }),
      url: row.url,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      ...(row.width !== null && { width: row.width }),
      ...(row.height !== null && { height: row.height }),
      ...(row.duration !== null && { duration: row.duration }),
      usageCount: row.usageCount,
      ...(row.folderId !== null && { folderId: row.folderId }),
      tagIds,
      createdAt: row.createdAt,
      ...(row.deletedAt !== null && { deletedAt: row.deletedAt }),
    });
  }
}
