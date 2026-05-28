/**
 * @file index.ts
 * @description Per-context barrel for security/credentials. Exposes the
 *   `PlatformCredentialService` (encrypted credential CRUD facade) alongside
 *   any existing use-cases already in this folder.
 * @layer application
 */

export { PlatformCredentialService } from "./PlatformCredentialService.js";
export { GetSecretRotationStatusQuery } from "./GetSecretRotationStatusQuery.js";
