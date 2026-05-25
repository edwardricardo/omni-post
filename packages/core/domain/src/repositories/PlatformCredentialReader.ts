/**
 * @file PlatformCredentialReader.ts
 * @description Narrow port exposing read access to the platform-wide credential
 *              group (base URL, support email, etc.). Use cases that only need
 *              to read platform settings depend on this interface rather than
 *              the full credential service (Interface Segregation).
 * @layer domain
 */

import { type Result } from "@shared/types";

/** Failure modes when reading platform credentials. */
export type PlatformCredentialReadError = "NOT_FOUND" | "ENCRYPTION_ERROR" | "DATABASE_ERROR";

export interface PlatformCredentialReader {
  /**
   * Read the decrypted key/value pairs of the platform-wide credential group.
   * Keys are credential names (e.g. `baseUrl`, `supportEmail`); values are the
   * decrypted strings.
   */
  getPlatformCredentials(): Promise<Result<Record<string, string>, PlatformCredentialReadError>>;
}
