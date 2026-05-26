/**
 * @file SamlConfigurationRepository.ts
 * @description Port interface for SAML configuration persistence.
 *              Technology-free -- concrete implementation lives in infrastructure layer.
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { SamlConfiguration } from "../entities/SamlConfiguration.js";

/**
 * Plain data transfer object for SAML configuration reads.
 */
export interface SamlConfigurationData {
  id: string;
  accountId: string;
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SamlConfigurationRepository {
  /**
   * @method findByAccountId
   * @description Retrieves SAML configuration for a given account, or null if not configured.
   */
  findByAccountId(accountId: string): Promise<SamlConfigurationData | null>;

  /**
   * @method save
   * @description Persists a SamlConfiguration entity (create or replace).
   */
  save(config: SamlConfiguration): Promise<Result<void, Error>>;

  /**
   * @method delete
   * @description Removes SAML configuration for the given account.
   */
  delete(accountId: string): Promise<Result<void, Error>>;
}
