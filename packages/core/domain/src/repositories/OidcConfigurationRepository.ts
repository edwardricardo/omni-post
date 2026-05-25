/**
 * @file OidcConfigurationRepository.ts
 * @description Port interface for OIDC configuration persistence.
 *              Technology-free -- concrete implementation lives in infrastructure layer.
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { OidcConfiguration } from "../entities/OidcConfiguration.js";

/**
 * Plain data transfer object for OIDC configuration reads.
 */
export interface OidcConfigurationData {
  id: string;
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  attributeMapping: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OidcConfigurationRepository {
  /**
   * @method findByAccountId
   * @description Retrieves OIDC configuration for a given account, or null if not configured.
   */
  findByAccountId(accountId: string): Promise<OidcConfigurationData | null>;

  /**
   * @method save
   * @description Persists an OidcConfiguration entity (create or replace).
   */
  save(config: OidcConfiguration): Promise<Result<void, Error>>;

  /**
   * @method delete
   * @description Removes OIDC configuration for the given account.
   */
  delete(accountId: string): Promise<Result<void, Error>>;
}
