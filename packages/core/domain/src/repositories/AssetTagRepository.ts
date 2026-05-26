/**
 * @file AssetTagRepository.ts
 * @description Repository port for AssetTag persistence.
 *   Tags are account-scoped labels applied to media assets.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Read-model DTO for asset tags.
 */
export interface AssetTagDTO {
  id: string;
  accountId: string;
  name: string;
  color: string;
  createdAt: Date;
}

/**
 * @interface AssetTagRepository
 * @description Port for AssetTag persistence operations.
 */
export interface AssetTagRepository {
  /**
   * @method findByAccount
   * @description List all tags belonging to an account.
   */
  findByAccount(accountId: string): Promise<AssetTagDTO[]>;

  /**
   * @method findByIds
   * @description Find tags by their IDs within an account scope.
   */
  findByIds(ids: string[], accountId: string): Promise<AssetTagDTO[]>;

  /**
   * @method save
   * @description Create a new asset tag.
   */
  save(data: {
    accountId: string;
    name: string;
    color?: string;
  }): Promise<Result<AssetTagDTO, Error>>;

  /**
   * @method delete
   * @description Delete an asset tag by ID within an account.
   */
  delete(id: string, accountId: string): Promise<Result<void, Error>>;
}
