// Core type definitions
export * from "./types";

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

// Lightweight server-side logger (console-based, for Next.js Server Actions)
export { createLogger } from "./logger";
