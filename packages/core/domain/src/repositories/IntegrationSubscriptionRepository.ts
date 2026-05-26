/**
 * @file IntegrationSubscriptionRepository.ts
 * @description Repository port for IntegrationSubscription persistence operations.
 *   Implemented by a Prisma adapter in the infrastructure layer.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { IntegrationSubscription } from "../entities/IntegrationSubscription.js";
import type { IntegrationPlatformValue } from "../entities/IntegrationApiKey.js";

/**
 * @interface IntegrationSubscriptionRepository
 * @description Defines the contract for integration webhook subscription data access.
 *   All methods return domain objects -- never raw ORM types.
 */
export interface IntegrationSubscriptionRepository {
  /**
   * Find a single subscription by its unique ID.
   */
  findById(id: string): Promise<IntegrationSubscription | null>;

  /**
   * Find all active subscriptions for a given event type (across all accounts).
   * Used by the event dispatcher to fan out webhook deliveries.
   */
  findActiveByEvent(event: string): Promise<IntegrationSubscription[]>;

  /**
   * Find all active subscriptions for a given event filtered by platform.
   * Used to fire events only to subscribers of a specific platform.
   */
  findActiveByEventAndPlatform(
    event: string,
    platform: IntegrationPlatformValue
  ): Promise<IntegrationSubscription[]>;

  /**
   * Find all subscriptions belonging to an account (active and inactive).
   */
  findByAccountId(accountId: string): Promise<IntegrationSubscription[]>;

  /**
   * Persist a new or updated subscription.
   */
  save(sub: IntegrationSubscription): Promise<Result<void, Error>>;
}
