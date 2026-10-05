/**
 * @file index.ts
 * @description Barrel exports for the shared domain package — types, errors, events, saga, CQRS,
 *              provider configuration, and template engine. The portals import this barrel in
 *              browser code, so nothing it reaches may need Node: the Node-only Channel.credentials
 *              envelope encryption is served from its own subpath,
 *              `@shared/types/channelCredentialsCrypto.js`, and is never re-exported here.
 * @layer domain
 */
// Core type definitions
export * from "./types.js";

// CSV export (pure RFC 4180 serializer; api, workers, admin frontend all use this)
export * from "./csv.js";

// Error handling
export * from "./errors.js";

// Event system
export * from "./events.js";

// Saga and CQRS patterns
export * from "./saga.js";
export * from "./cqrs.js";

// Provider configuration (centralized)
export * from "./providers/providerConfig.js";

// Re-export provider types explicitly for better IDE support
export type {
  ProviderCapabilities,
  ProviderLimits,
  ProviderMetadata,
  ValidationResult,
} from "./providers/providerConfig.js";

export {
  PROVIDER_CONFIGS,
  getProviderConfig,
  getActiveProviders,
  getProviderIds,
  validateContentForProvider,
  validateContentForProviders,
  getMostRestrictiveCharLimit,
  getMostRestrictiveMediaLimit,
} from "./providers/providerConfig.js";

// Template engine
export * from "./templates/BaseTemplateEngine.js";
export type {
  Template,
  TemplateVariable,
  TemplateVariant,
  TemplateContext,
  TemplateCompilationResult,
} from "./templates/BaseTemplateEngine.js";
