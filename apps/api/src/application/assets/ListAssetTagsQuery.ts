/**
 * @file ListAssetTagsQuery.ts
 * @description Query handler for listing all asset tags belonging to an account.
 *   Delegates directly to the asset tag repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type AssetTagRepository,
  type AssetTagDTO,
} from "../../domain/repositories/AssetTagRepository.js";

/**
 * Input DTO for listing asset tags.
 */
export interface ListAssetTagsInput {
  accountId: string;
}

/**
 * @class ListAssetTagsQuery
 * @description Fetches all asset tags for an account from the repository.
 */
export class ListAssetTagsQuery
  implements UseCase<ListAssetTagsInput, AssetTagDTO[], UseCaseError>
{
  constructor(private readonly assetTagRepository: AssetTagRepository) {}

  /**
   * @method execute
   * @description Lists all asset tags for the given account.
   * @param input - Account ID to scope the query
   * @returns Result containing an array of AssetTagDTO
   */
  async execute(input: ListAssetTagsInput): Promise<Result<AssetTagDTO[], UseCaseError>> {
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(
        new UseCaseError("Account ID must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const tags = await this.assetTagRepository.findByAccount(input.accountId);
    return ok(tags);
  }
}
