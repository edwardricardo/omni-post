/**
 * @file CampaignRepository.ts
 * @description Command repository port for Campaign aggregate persistence.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type Campaign } from "../entities/Campaign.js";
import { type CampaignId } from "../value-objects/EntityId.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * @interface CampaignRepository
 * @description Port for Campaign persistence operations (command side).
 */
export interface CampaignRepository {
  /**
   * @method save
   * @description Persist a Campaign entity (create or update).
   */
  save(campaign: Campaign): Promise<Result<void, Error>>;

  /**
   * @method findById
   * @description Find a Campaign by its ID.
   */
  findById(id: CampaignId): Promise<Result<Campaign, EntityNotFoundError>>;

  /**
   * @method delete
   * @description Delete a Campaign by its ID.
   */
  delete(id: CampaignId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * @method addPost
   * @description Tag a post with this campaign.
   */
  addPost(campaignId: CampaignId, postId: string): Promise<Result<void, Error>>;

  /**
   * @method removePost
   * @description Untag a post from this campaign.
   */
  removePost(campaignId: CampaignId, postId: string): Promise<Result<void, Error>>;
}
