/**
 * @file PrismaAssetTagRepository.ts
 * @description Prisma adapter implementing the AssetTagRepository port.
 *   Provides CRUD operations for account-scoped asset tags.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import {
  type AssetTagRepository,
  type AssetTagDTO,
} from "../../domain/repositories/AssetTagRepository.js";

/**
 * Raw Prisma row shape for an AssetTag record.
 */
interface PrismaAssetTagRow {
  id: string;
  accountId: string;
  name: string;
  color: string | null;
  createdAt: Date;
}

/**
 * Default tag color when none is specified by the schema default.
 */
const DEFAULT_COLOR = "#6366f1";

/**
 * @class PrismaAssetTagRepository
 * @description Infrastructure adapter implementing AssetTagRepository using Prisma ORM.
 */
export class PrismaAssetTagRepository implements AssetTagRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findByAccount
   * @description Lists all tags belonging to an account, ordered by name.
   * @param accountId - The account to scope the query
   * @returns Array of AssetTagDTO sorted by name ascending
   */
  async findByAccount(accountId: string): Promise<AssetTagDTO[]> {
    const rows = await this.prisma.assetTag.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
    });

    return rows.map((row) => this.toDTO(row as unknown as PrismaAssetTagRow));
  }

  /**
   * @method findByIds
   * @description Finds tags by their IDs within an account scope.
   * @param ids - Tag IDs to look up
   * @param accountId - Ownership scope
   * @returns Array of matching AssetTagDTO
   */
  async findByIds(ids: string[], accountId: string): Promise<AssetTagDTO[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.prisma.assetTag.findMany({
      where: {
        id: { in: ids },
        accountId,
      },
    });

    return rows.map((row) => this.toDTO(row as unknown as PrismaAssetTagRow));
  }

  /**
   * @method save
   * @description Creates a new asset tag. The database enforces a unique constraint
   *   on (accountId, name), so duplicate names will produce a Prisma error.
   * @param data - Tag creation data
   * @returns Result<AssetTagDTO> on success, Error on unique violation or failure
   */
  async save(data: {
    accountId: string;
    name: string;
    color?: string;
  }): Promise<Result<AssetTagDTO, Error>> {
    try {
      const row = await this.prisma.assetTag.create({
        data: {
          accountId: data.accountId,
          name: data.name,
          ...(data.color !== undefined && { color: data.color }),
        },
      });

      return ok(this.toDTO(row as unknown as PrismaAssetTagRow));
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method delete
   * @description Deletes an asset tag by ID within an account. The database
   *   cascades deletion to AssetTagOnAsset join records.
   * @param id - Tag UUID
   * @param accountId - Ownership scope
   * @returns Result<void> on success, Error if not found or failure
   */
  async delete(id: string, accountId: string): Promise<Result<void, Error>> {
    try {
      const existing = await this.prisma.assetTag.findFirst({
        where: { id, accountId },
        select: { id: true },
      });

      if (!existing) {
        return err(new Error(`Asset tag not found: ${id}`));
      }

      await this.prisma.assetTag.delete({
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
   * @description Maps a raw Prisma row to an AssetTagDTO.
   */
  private toDTO(row: PrismaAssetTagRow): AssetTagDTO {
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      color: row.color ?? DEFAULT_COLOR,
      createdAt: row.createdAt,
    };
  }
}
