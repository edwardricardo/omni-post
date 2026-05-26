/**
 * @file MentionRepository.ts
 * @description Command repository port for Mention aggregates (brand-listening).
 *   Persists ingested mentions and exposes the provider dedup lookup. The read
 *   side (filters, share-of-voice) lives in the separate MentionQueryRepository.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type MentionAggregate } from "../aggregates/MentionAggregate.js";
import { type ProviderType } from "../value-objects/Provider.js";

/**
 * @interface MentionRepository
 * @description Command repository port for Mention aggregate persistence.
 */
export interface MentionRepository {
  /**
   * @method findByProviderExternalId
   * @description Find a mention by its provider dedup key (provider, externalId).
   * @param provider - The social provider
   * @param externalId - The provider's mention/post ID
   * @returns The aggregate if found, null otherwise
   */
  findByProviderExternalId(
    provider: ProviderType,
    externalId: string
  ): Promise<MentionAggregate | null>;

  /**
   * @method save
   * @description Persist a Mention aggregate (insert).
   * @param mention - The Mention aggregate to save
   * @returns Result<void> on success, Error on failure
   */
  save(mention: MentionAggregate): Promise<Result<void, Error>>;
}
