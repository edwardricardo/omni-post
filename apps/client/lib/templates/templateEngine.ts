/**
 * @file templateEngine.ts
 * @description Barrel re-export of ClientTemplateEngine and shared template types for
 *              backwards-compatible imports in the client app.
 * @layer infrastructure
 */

export * from "./ClientTemplateEngine.js";
export { clientTemplateEngine as templateEngine } from "./ClientTemplateEngine.js";

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
