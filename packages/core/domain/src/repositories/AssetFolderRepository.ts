/**
 * @file AssetFolderRepository.ts
 * @description Repository port for AssetFolder persistence.
 *   Folders provide hierarchical organization for media assets.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Read-model DTO for asset folders.
 */
export interface AssetFolderDTO {
  id: string;
  accountId: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
}

/**
 * @interface AssetFolderRepository
 * @description Port for AssetFolder persistence operations.
 */
export interface AssetFolderRepository {
  /**
   * @method findByAccount
   * @description List all folders belonging to an account.
   */
  findByAccount(accountId: string): Promise<AssetFolderDTO[]>;

  /**
   * @method findById
   * @description Find a folder by ID within an account scope.
   */
  findById(id: string, accountId: string): Promise<AssetFolderDTO | null>;

  /**
   * @method save
   * @description Create a new asset folder.
   */
  save(data: {
    accountId: string;
    name: string;
    parentId?: string;
  }): Promise<Result<AssetFolderDTO, Error>>;

  /**
   * @method delete
   * @description Delete an asset folder by ID within an account.
   */
  delete(id: string, accountId: string): Promise<Result<void, Error>>;
}
