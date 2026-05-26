/**
 * @file IntegrationApiKeyRepository.ts
 * @description Repository port for IntegrationApiKey persistence operations.
 *   Implemented by a Prisma adapter in the infrastructure layer.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { IntegrationApiKey } from "../entities/IntegrationApiKey.js";

/**
 * @interface IntegrationApiKeyRepository
 * @description Defines the contract for integration API key data access.
 *   All methods return domain objects -- never raw ORM types.
 */
export interface IntegrationApiKeyRepository {
  /**
   * Find a single API key by its unique ID.
   */
  findById(id: string): Promise<IntegrationApiKey | null>;

  /**
   * Find all active (non-revoked) API keys belonging to an account.
   */
  findActiveByAccountId(accountId: string): Promise<IntegrationApiKey[]>;

  /**
   * Find API keys by their visible prefix. Used during authentication
   * to narrow candidates before hash verification.
   */
  findByKeyPrefix(prefix: string): Promise<IntegrationApiKey[]>;

  /**
   * Persist a new or updated API key.
   */
  save(key: IntegrationApiKey): Promise<Result<void, Error>>;

  /**
   * Count the number of active (non-revoked) keys for an account.
   * Used to enforce per-account key limits.
   */
  countActiveByAccountId(accountId: string): Promise<number>;
}
