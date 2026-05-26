/**
 * @file PrismaAssetFolderRepository.ts
 * @description Prisma adapter implementing the AssetFolderRepository port.
 *   Provides CRUD operations for account-scoped asset folders with
 *   hierarchical parent-child support.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import {
  type AssetFolderRepository,
  type AssetFolderDTO,
} from "@core/domain/repositories/AssetFolderRepository.js";

/**
 * Raw Prisma row shape for an AssetFolder record.
 */
interface PrismaAssetFolderRow {
  id: string;
  accountId: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
}

/**
 * @class PrismaAssetFolderRepository
 * @description Infrastructure adapter implementing AssetFolderRepository using Prisma ORM.
 */
export class PrismaAssetFolderRepository implements AssetFolderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByAccount
   * @description Lists all folders belonging to an account, ordered by name.
   * @param accountId - The account to scope the query
   * @returns Array of AssetFolderDTO sorted by name ascending
   */
  async findByAccount(accountId: string): Promise<AssetFolderDTO[]> {
    const rows = await this.prisma.assetFolder.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
    });

    return rows.map((row) => this.toDTO(row as unknown as PrismaAssetFolderRow));
  }

  /**
   * @method findById
   * @description Finds a folder by ID within an account scope.
   * @param id - Folder UUID
   * @param accountId - Ownership scope
   * @returns AssetFolderDTO or null if not found
   */
  async findById(id: string, accountId: string): Promise<AssetFolderDTO | null> {
    const row = await this.prisma.assetFolder.findFirst({
      where: { id, accountId },
    });

    if (!row) {
      return null;
    }

    return this.toDTO(row as unknown as PrismaAssetFolderRow);
  }

  /**
   * @method save
   * @description Creates a new asset folder.
   * @param data - Folder creation data including accountId, name, and optional parentId
   * @returns Result<AssetFolderDTO> on success, Error on failure
   */
  async save(data: {
    accountId: string;
    name: string;
    parentId?: string;
  }): Promise<Result<AssetFolderDTO, Error>> {
    try {
      const row = await this.prisma.assetFolder.create({
        data: {
          accountId: data.accountId,
          name: data.name,
          ...(data.parentId !== undefined && { parentId: data.parentId }),
        },
      });

      return ok(this.toDTO(row as unknown as PrismaAssetFolderRow));
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method delete
   * @description Deletes an asset folder by ID within an account.
   *   Assets in the folder are NOT cascaded (they become "unfiled").
   * @param id - Folder UUID
   * @param accountId - Ownership scope
   * @returns Result<void> on success, Error if not found or failure
   */
  async delete(id: string, accountId: string): Promise<Result<void, Error>> {
    try {
      const existing = await this.prisma.assetFolder.findFirst({
        where: { id, accountId },
        select: { id: true },
      });

      if (!existing) {
        return err(new Error(`Asset folder not found: ${id}`));
      }

      // Unfile assets in the folder before deletion
      await this.prisma.mediaAsset.updateMany({
        where: { folderId: id, accountId },
        data: { folderId: null },
      });

      // Move child folders to root (null parent)
      await this.prisma.assetFolder.updateMany({
        where: { parentId: id, accountId },
        data: { parentId: null },
      });

      await this.prisma.assetFolder.delete({
        where: { id },
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
   * @method toDTO
   * @description Maps a raw Prisma row to an AssetFolderDTO.
   */
  private toDTO(row: PrismaAssetFolderRow): AssetFolderDTO {
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      parentId: row.parentId,
      createdAt: row.createdAt,
    };
  }
}
