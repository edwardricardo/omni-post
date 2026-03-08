/**
 * Client-Safe Exports
 *
 * This file exports only the modules that are safe to use in browser/client environments.
 * It excludes server-only dependencies like handlebars (used in BaseTemplateEngine).
 */

// Core types (safe for client)
export * from "./types";

// Event system (safe for client)
export * from "./events";

// Saga and CQRS patterns (safe for client)
export * from "./saga";
export * from "./cqrs";

// Provider configuration (safe for client - no server dependencies)
export type {
  ProviderId,
  ProviderCapabilities,
  ProviderLimits,
  ProviderMetadata,
  ValidationResult as ProviderValidationResult,
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

// Template types (safe for client - no server dependencies)
export type {
  Template,
  TemplateVariable,
  TemplateVariant,
  TemplateContext,
  TemplateCompilationResult,
  ValidationResult as TemplateValidationResult,
} from "./templates/types";

// DO NOT export BaseTemplateEngine here - it uses handlebars which is server-only
