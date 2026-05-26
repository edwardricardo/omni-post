/**
 * @file MediaAssetRepository.ts
 * @description Command and query repository port for MediaAsset persistence.
 *   Supports cursor-based pagination, tag filtering, and soft-delete.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type MediaAsset } from "../entities/MediaAsset.js";

/**
 * Filter criteria for querying media assets.
 */
export interface MediaAssetFilters {
  accountId: string;
  projectId?: string;
  folderId?: string | null;
  tagIds?: string[];
  mimeType?: string;
  search?: string;
  limit?: number;
  cursor?: string | null;
}

/**
 * Cursor-based paginated result for media assets.
 */
export interface MediaAssetPaginatedResult {
  items: MediaAsset[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * @interface MediaAssetRepository
 * @description Port for MediaAsset persistence operations (command + query).
 */
export interface MediaAssetRepository {
  /**
   * @method findById
   * @description Find a single media asset by ID within an account.
   */
  findById(id: string, accountId: string): Promise<MediaAsset | null>;

  /**
   * @method findMany
   * @description Query media assets with filters and cursor-based pagination.
   */
  findMany(filters: MediaAssetFilters): Promise<MediaAssetPaginatedResult>;

  /**
   * @method save
   * @description Persist a MediaAsset entity (create or update).
   */
  save(asset: MediaAsset): Promise<Result<MediaAsset, Error>>;

  /**
   * @method softDelete
   * @description Mark a media asset as deleted without removing from storage.
   */
  softDelete(id: string, accountId: string): Promise<Result<void, Error>>;

  /**
   * @method updateTags
   * @description Replace the tag associations for an asset.
   */
  updateTags(assetId: string, tagIds: string[]): Promise<Result<void, Error>>;
}
