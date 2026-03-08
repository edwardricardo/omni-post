/**
 * Template Engine - Client Application
 *
 * This file now re-exports the ClientTemplateEngine from the new implementation.
 * All template functionality has been consolidated into:
 * - BaseTemplateEngine (packages/shared) - shared helpers and core logic
 * - ClientTemplateEngine (this directory) - client-specific features
 *
 * ✅ P1-2: Template Engine Unification Complete
 * - Eliminated ~500 lines of duplicate Handlebars helper code
 * - Centralized template compilation, validation, and rendering
 * - Maintained all client-specific features (preview, documentation, API calls)
 */

export * from "./ClientTemplateEngine";
export { clientTemplateEngine as templateEngine } from "./ClientTemplateEngine";

// Re-export types from @shared/types for backward compatibility
export type {
  Template,
  TemplateVariable,
  TemplateVariant,
  TemplateContext,
  TemplateCompilationResult,
  ValidationResult,
} from "@shared/types";

// Legacy ABTestConfig type for backward compatibility
import type { TemplateVariant } from "@shared/types";

export interface ABTestConfig {
  enabled: boolean;
  variants: TemplateVariant[];
  trafficSplit?: number[];
  startDate?: Date;
  endDate?: Date;
}
