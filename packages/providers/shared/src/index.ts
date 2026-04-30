/**
 * @file index.ts
 * @description Barrel exports for the shared provider helpers — AbstractProviderAdapter,
 *              ProviderError, credential types, and validation helpers.
 * @layer infrastructure
 */
// Abstract Provider Adapter (class-based architecture)
export { AbstractProviderAdapter } from "./AbstractProviderAdapter.js";

// Channel credentials port — apps wire the Prisma-backed implementation at
// startup so the providers package itself stays free of infrastructure imports.
export {
  setChannelCredentialsRepository,
  type ChannelCredentialsRepository,
} from "./channelCredentialsRepository.js";

// Structured provider errors
export { ProviderError, ProviderErrorCode } from "./ProviderError.js";

// Export types from AbstractProviderAdapter
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
} from "./AbstractProviderAdapter.js";
