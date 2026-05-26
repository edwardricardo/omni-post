/**
 * @file SocialMessageRepository.ts
 * @description Command repository port for SocialMessage aggregates.
 *   Defines the contract for persisting and retrieving social inbox messages.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type EntityNotFoundError } from "../errors/index.js";
import { type SocialMessageId } from "../value-objects/SocialMessageId.js";
import { type SocialMessageAggregate } from "../aggregates/SocialMessageAggregate.js";
import { type ProviderType } from "../value-objects/Provider.js";

/**
 * @interface SocialMessageRepository
 * @description Command repository port for SocialMessage aggregate persistence.
 */
export interface SocialMessageRepository {
  /**
   * @method findById
   * @description Find a SocialMessage aggregate by its ID.
   * @param id - The SocialMessageId to search for
   * @returns Result containing the aggregate on success, EntityNotFoundError on failure
   */
  findById(id: SocialMessageId): Promise<Result<SocialMessageAggregate, EntityNotFoundError>>;

  /**
   * @method findByProviderMessageId
   * @description Find a SocialMessage by provider + providerMessageId (dedup key).
   * @param provider - The social provider
   * @param providerMessageId - The provider's message ID
   * @returns The aggregate if found, null if not
   */
  findByProviderMessageId(
    provider: ProviderType,
    providerMessageId: string
  ): Promise<SocialMessageAggregate | null>;

  /**
   * @method save
   * @description Persist a SocialMessage aggregate (create or update).
   * @param aggregate - The SocialMessage aggregate to save
   * @returns Result<void> on success, Error on failure
   */
  save(aggregate: SocialMessageAggregate): Promise<Result<void, Error>>;

  /**
   * @method softDelete
   * @description Soft-delete a SocialMessage by archiving it.
   * @param id - The SocialMessageId to archive
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  softDelete(id: SocialMessageId): Promise<Result<void, EntityNotFoundError>>;
}
