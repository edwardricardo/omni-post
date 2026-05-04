/**
 * @file index.ts
 * @description Barrel exports for the shared provider package: composition
 *   helpers, structured errors, and shared metadata/credential types used by
 *   concrete provider adapters.
 * @layer infrastructure
 */

// Composition helpers (stateless functions used by concrete adapters)
export {
  validateCredentialStructure,
  uploadMediaWithRetry,
  uploadMediaBatch,
  mapErrorToPublishError,
  validateApiResponse,
  validateContentForLimits,
  generateProviderPreview,
} from "./helpers.js";

// Structured provider errors
export { ProviderError, ProviderErrorCode } from "./ProviderError.js";

// Shared metadata and credential types
export type {
  ProviderCredentials,
  MediaUploadResult,
  MediaUploadOptions,
  ProviderMetadata,
  ProviderConstraints,
  ProviderAuthType,
  ContentValidationResult,
  ProviderPreview,
  ConnectionConfig,
  ProviderCapabilities,
  HealthCheckResult,
  AccountInfo,
} from "./providerTypes.js";
