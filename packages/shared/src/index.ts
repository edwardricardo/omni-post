/**
 * @file index.ts
 * @description Barrel exports for the shared domain package — types, errors, events, saga, CQRS,
 *              provider configuration, and template engine.
 * @layer domain
 */
// Core type definitions
export * from "./types";

// Channel.credentials envelope encryption (api, workers, seed all use this)
export * from "./channelCredentialsCrypto";

// CSV export (pure RFC 4180 serializer; api, workers, admin frontend all use this)
export * from "./csv";

// Error handling
export * from "./errors";

// Event system
export * from "./events";

// Saga and CQRS patterns
export * from "./saga";
export * from "./cqrs";

// Provider configuration (centralized)
export * from "./providers/providerConfig";

// Re-export provider types explicitly for better IDE support
export type {
  ProviderCapabilities,
  ProviderLimits,
  ProviderMetadata,
  ValidationResult,
} from "./providers/providerConfig";

export {
  PROVIDER_CONFIGS,
  getProviderConfig,
  getActiveProviders,
  getProviderIds,
  validateContentForProvider,
  validateContentForProviders,
  getMostRestrictiveCharLimit,
  getMostRestrictiveMediaLimit,
} from "./providers/providerConfig";

// Template engine
export * from "./templates/BaseTemplateEngine";
export type {
  Template,
  TemplateVariable,
  TemplateVariant,
  TemplateContext,
  TemplateCompilationResult,
} from "./templates/BaseTemplateEngine";
