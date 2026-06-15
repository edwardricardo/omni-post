/**
 * @file client.ts
 * @description Browser-safe barrel re-exports — types, events, saga, and CQRS only, excluding
 *              server-only modules like BaseTemplateEngine (Handlebars).
 * @layer domain
 */

// Core types (safe for client)
export * from "./types.js";

// Event system (safe for client)
export * from "./events.js";

// Saga and CQRS patterns (safe for client)
export * from "./saga.js";
export * from "./cqrs.js";

// Provider configuration (safe for client - no server dependencies)
export type {
  ProviderId,
  ProviderCapabilities,
  ProviderLimits,
  ProviderMetadata,
  ValidationResult as ProviderValidationResult,
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

// Template types (safe for client - no server dependencies)
export type {
  Template,
  TemplateVariable,
  TemplateVariant,
  TemplateContext,
  TemplateCompilationResult,
  ValidationResult as TemplateValidationResult,
} from "./templates/types.js";

// DO NOT export BaseTemplateEngine here - it uses handlebars which is server-only
